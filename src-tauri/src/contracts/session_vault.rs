use super::ContractFuture;

/// Identifies one account's platform session without containing session data.
#[derive(Clone, Eq, Hash, PartialEq)]
pub struct SessionKey {
    account_id: String,
    platform: String,
}

impl SessionKey {
    pub fn new(account_id: impl Into<String>, platform: impl Into<String>) -> Self {
        Self {
            account_id: account_id.into(),
            platform: platform.into(),
        }
    }

    pub fn account_id(&self) -> &str {
        &self.account_id
    }

    pub fn platform(&self) -> &str {
        &self.platform
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SessionFormatVersion(u32);

impl SessionFormatVersion {
    pub const fn new(value: u32) -> Self {
        Self(value)
    }

    pub const fn get(self) -> u32 {
        self.0
    }
}

/// Opaque session material paired with its persisted format version.
///
/// The secret type is chosen by the future vault implementation so this
/// contract does not pretend that plaintext storage or encryption exists.
pub struct VaultSession<S> {
    pub format_version: SessionFormatVersion,
    pub secret: S,
}

/// Port for a future authenticated, encrypted session store.
///
/// No implementation is registered in the current application skeleton.
pub trait SessionVault: Send + Sync {
    type Secret: Send;

    fn load<'a>(
        &'a self,
        key: &'a SessionKey,
    ) -> ContractFuture<'a, Option<VaultSession<Self::Secret>>>;

    fn store<'a>(
        &'a self,
        key: SessionKey,
        session: VaultSession<Self::Secret>,
    ) -> ContractFuture<'a, ()>;

    fn delete<'a>(&'a self, key: &'a SessionKey) -> ContractFuture<'a, ()>;
}
