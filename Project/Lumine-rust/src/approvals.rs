use std::collections::HashMap;
use std::sync::Mutex;

use tokio::sync::oneshot;

#[derive(Default)]
pub struct ApprovalHub {
    pending: Mutex<HashMap<String, oneshot::Sender<bool>>>,
}

impl ApprovalHub {
    pub fn register(&self, id: String) -> oneshot::Receiver<bool> {
        let (tx, rx) = oneshot::channel();
        self.pending.lock().expect("approval mutex").insert(id, tx);
        rx
    }

    pub fn decide(&self, id: &str, allow: bool) -> Result<(), String> {
        let tx = self
            .pending
            .lock()
            .expect("approval mutex")
            .remove(id)
            .ok_or_else(|| "没有这条待审批请求".to_owned())?;
        tx.send(allow).map_err(|_| "审批通道已关闭".to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn decide_resolves_waiter() {
        let hub = ApprovalHub::default();
        let rx = hub.register("a1".into());
        hub.decide("a1", true).unwrap();
        assert!(rx.await.unwrap());
        assert!(hub.decide("missing", false).is_err());
    }
}
