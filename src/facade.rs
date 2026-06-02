use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    http::StatusCode,
    response::{Html, IntoResponse, Response},
    routing::get,
    Router,
};
use futures_util::{SinkExt, StreamExt};
use snafu::{ResultExt, Snafu};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::{
    application::{config::Config, ports::AppDeps},
    domain::{
        protocol::{parse_first_packet, Destination, ProtocolError},
        subscription::generate_subscription,
    },
    infrastructure::runtime::{IoSnafu, RuntimeError},
};

const INDEX_HTML: &str = include_str!("../index.html");

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub deps: AppDeps,
}

#[derive(Debug, Snafu)]
pub enum ProxyError {
    #[snafu(display("protocol error: {source}"))]
    Protocol { source: ProtocolError },

    #[snafu(display("runtime error: {source}"))]
    Runtime { source: RuntimeError },

    #[snafu(display("blocked destination {host}"))]
    Blocked { host: String },

    #[snafu(display("websocket closed before first packet"))]
    MissingFirstPacket,

    #[snafu(display("first websocket message was not binary"))]
    NonBinaryFirstPacket,

    #[snafu(display("websocket send failed"))]
    WebSocketSend { source: axum::Error },
}

pub fn router(state: AppState) -> Router {
    let ws_path = format!("/{}", state.config.ws_path);
    let sub_path = format!("/{}", state.config.sub_path);

    let router = Router::new()
        .route("/", get(root))
        .route(&ws_path, get(websocket));

    let router = if state.config.enable_sub {
        router.route(&sub_path, get(subscription))
    } else {
        router
    };

    router.with_state(state)
}

async fn root() -> Html<&'static str> {
    Html(INDEX_HTML)
}

async fn subscription(State(state): State<AppState>) -> Response {
    let isp = state.deps.isp.isp().await;
    let ip_info = state
        .deps
        .public_ip
        .detect(state.config.domain.as_deref(), state.config.port)
        .await;
    let body = format!("{}\n", generate_subscription(&state.config, &ip_info, &isp));
    ([(axum::http::header::CONTENT_TYPE, "text/plain")], body).into_response()
}

async fn websocket(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| async move {
        if let Err(error) = proxy_websocket(socket, state).await {
            tracing::debug!(%error, "websocket proxy session ended");
        }
    })
}

pub async fn proxy_websocket(mut socket: WebSocket, state: AppState) -> Result<(), ProxyError> {
    let first = match socket.next().await {
        Some(Ok(Message::Binary(packet))) => packet,
        Some(Ok(_)) => return Err(ProxyError::NonBinaryFirstPacket),
        Some(Err(source)) => return Err(ProxyError::WebSocketSend { source }),
        None => return Err(ProxyError::MissingFirstPacket),
    };

    let request = parse_first_packet(&first, state.config.uuid).context(ProtocolSnafu)?;
    if state.deps.policy.is_blocked(&request.destination.host) {
        return Err(ProxyError::Blocked {
            host: request.destination.host,
        });
    }

    let resolved_host = state
        .deps
        .resolver
        .resolve(&request.destination.host)
        .await
        .context(RuntimeSnafu)?;
    let destination = Destination {
        host: resolved_host,
        port: request.destination.port,
    };

    let target = state
        .deps
        .connector
        .connect(&destination)
        .await
        .context(RuntimeSnafu)?;

    if let Some(response) = request.handshake_response.as_deref() {
        socket
            .send(Message::Binary(response.to_vec()))
            .await
            .context(WebSocketSendSnafu)?;
    }

    let (mut target_reader, mut target_writer) = target.into_split();
    if request.payload_offset < first.len() {
        target_writer
            .write_all(&first[request.payload_offset..])
            .await
            .context(IoSnafu)
            .context(RuntimeSnafu)?;
    }

    let (mut ws_sender, mut ws_receiver) = socket.split();
    let client_to_target = async {
        while let Some(message) = ws_receiver.next().await {
            match message.context(WebSocketSendSnafu)? {
                Message::Binary(bytes) => {
                    target_writer
                        .write_all(&bytes)
                        .await
                        .context(IoSnafu)
                        .context(RuntimeSnafu)?;
                }
                Message::Close(_) => break,
                Message::Ping(_) | Message::Pong(_) | Message::Text(_) => {}
            }
        }
        let _ = target_writer.shutdown().await;
        Ok::<(), ProxyError>(())
    };

    let target_to_client = async {
        let mut buffer = vec![0u8; 16 * 1024];
        loop {
            let n = target_reader
                .read(&mut buffer)
                .await
                .context(IoSnafu)
                .context(RuntimeSnafu)?;
            if n == 0 {
                break;
            }
            ws_sender
                .send(Message::Binary(buffer[..n].to_vec()))
                .await
                .context(WebSocketSendSnafu)?;
        }
        let _ = ws_sender.close().await;
        Ok::<(), ProxyError>(())
    };

    tokio::select! {
        result = client_to_target => result,
        result = target_to_client => result,
    }
}

pub fn not_found() -> impl IntoResponse {
    StatusCode::NOT_FOUND
}
