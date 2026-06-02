use std::collections::HashMap;

use snafu::{ResultExt, Snafu};
use uuid::Uuid;

const DEFAULT_UUID: &str = "5efabea4-f6d4-91fd-b8f0-17e004c89c60";

#[derive(Debug, Clone)]
pub struct Config {
    pub uuid: Uuid,
    pub uuid_text: String,
    pub nezha_server: Option<String>,
    pub nezha_port: Option<String>,
    pub nezha_key: Option<String>,
    pub domain: Option<String>,
    pub auto_access: bool,
    pub ws_path: String,
    pub sub_path: String,
    pub name: Option<String>,
    pub port: u16,
    pub enable_sub: bool,
}

#[derive(Debug, Snafu)]
pub enum ConfigError {
    #[snafu(display("invalid UUID `{value}`"))]
    InvalidUuid { value: String, source: uuid::Error },

    #[snafu(display("invalid PORT `{value}`"))]
    InvalidPort {
        value: String,
        source: std::num::ParseIntError,
    },

    #[snafu(display("invalid AUTO_ACCESS `{value}`"))]
    InvalidBool {
        value: String,
        source: std::str::ParseBoolError,
    },

    #[snafu(display("WSPATH is empty and UUID cannot provide an 8 byte prefix"))]
    InvalidWsPath,

    #[snafu(display("invalid bool `{key}={value}`"))]
    InvalidBoolValue {
        key: String,
        value: String,
        source: std::str::ParseBoolError,
    },
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_pairs(std::env::vars())
    }

    pub fn from_pairs<K, V, I>(pairs: I) -> Result<Self, ConfigError>
    where
        K: Into<String>,
        V: Into<String>,
        I: IntoIterator<Item = (K, V)>,
    {
        let values = pairs
            .into_iter()
            .map(|(key, value)| (key.into(), value.into()))
            .collect::<HashMap<_, _>>();

        let uuid_text = values
            .get("UUID")
            .cloned()
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| DEFAULT_UUID.to_string());
        let uuid = Uuid::parse_str(&uuid_text).context(InvalidUuidSnafu {
            value: uuid_text.clone(),
        })?;

        let port_text = values
            .get("PORT")
            .cloned()
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "3000".to_string());
        let port = port_text.parse::<u16>().context(InvalidPortSnafu {
            value: port_text.clone(),
        })?;

        let auto_access_text = values
            .get("AUTO_ACCESS")
            .cloned()
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "false".to_string());
        let auto_access = auto_access_text.parse::<bool>().context(InvalidBoolSnafu {
            value: auto_access_text.clone(),
        })?;

        let ws_path = match values.get("WSPATH").filter(|value| !value.is_empty()) {
            Some(value) => trim_leading_slash(value),
            None => uuid_text
                .replace('-', "")
                .get(..8)
                .map(str::to_string)
                .ok_or(ConfigError::InvalidWsPath)?,
        };

        Ok(Self {
            uuid,
            uuid_text,
            nezha_server: non_empty(&values, "NEZHA_SERVER"),
            nezha_port: non_empty(&values, "NEZHA_PORT"),
            nezha_key: non_empty(&values, "NEZHA_KEY"),
            domain: non_empty(&values, "DOMAIN"),
            auto_access,
            ws_path,
            sub_path: non_empty(&values, "SUB_PATH").unwrap_or_else(|| "sub".to_string()),
            name: non_empty(&values, "NAME"),
            enable_sub: non_empty(&values, "ENABLE_SUB")
                .unwrap_or_else(|| "false".to_string())
                .parse::<bool>()
                .context(InvalidBoolValueSnafu {
                    key: "ENABLE_SUB".to_string(),
                    value: non_empty(&values, "ENABLE_SUB").unwrap_or_else(|| "false".to_string()),
                })?,
            port,
        })
    }
}

fn non_empty(values: &HashMap<String, String>, key: &str) -> Option<String> {
    values.get(key).cloned().filter(|value| !value.is_empty())
}

fn trim_leading_slash(value: &str) -> String {
    value.trim_start_matches('/').to_string()
}
