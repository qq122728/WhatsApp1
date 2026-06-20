use super::ContractFuture;

/// High-level lifecycle only; the wire protocol remains pending ADR-006.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PairingState {
    Unpaired,
    Pending,
    Paired,
    Revoked,
}

/// Port reserved for the future remote-control device pairing workflow.
///
/// Associated types keep pairing challenges and credentials opaque until the
/// server protocol and secure storage requirements are finalized.
pub trait DevicePairing: Send + Sync {
    type Request: Send;
    type Challenge: Send;
    type Completion: Send;

    fn state<'a>(&'a self) -> ContractFuture<'a, PairingState>;

    fn begin<'a>(&'a self, request: Self::Request) -> ContractFuture<'a, Self::Challenge>;

    fn complete<'a>(&'a self, completion: Self::Completion) -> ContractFuture<'a, ()>;

    fn revoke<'a>(&'a self) -> ContractFuture<'a, ()>;
}
