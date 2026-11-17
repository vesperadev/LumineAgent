use reqwest::Client;
use serde_json::{json, Value};

pub async fn chat(client: &Client, model: &str, system: &str, user: &str) -> Option<String> {
    let api_key = match std::env::var("DEEPSEEK_API_KEY") {
        Ok(v) => v,
        Err(e) => {
            tracing::error!(?e, "failed to read DEEPSEEK_API_KEY");
            return None;
        }
    };
    let body = json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user}
        ]
    });

    let resp = client
        .post("https://api.deepseek.com/v1/chat/completions")
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| { tracing::error!(error = %e, "request send failed"); e })
        .ok()?
        .error_for_status()
        .map_err(|e| { tracing::error!(error = %e, "HTTP error status"); e })
        .ok()?
        .json::<Value>()
        .await
        .map_err(|e| { tracing::error!(error = %e, "response JSON parse failed"); e })
        .ok()?;

    resp["choices"][0]["message"]["content"]
        .as_str()
        .map(|s| s.to_string())
}