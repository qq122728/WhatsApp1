use std::{future::Future, pin::Pin};

use crate::error::AppResult;

pub mod device_pairing;
pub mod session_vault;

pub type ContractFuture<'a, T> = Pin<Box<dyn Future<Output = AppResult<T>> + Send + 'a>>;
