use crate::error::{AppError, AppResult, ErrorCode};

#[cfg(target_os = "windows")]
pub async fn replace_focused_text(text: String) -> AppResult<()> {
    tokio::task::spawn_blocking(move || windows::replace_focused_text(&text))
        .await
        .map_err(|error| {
            AppError::new(
                ErrorCode::WaPanelFailed,
                format!("Native input task failed: {error}"),
            )
        })?
}

#[cfg(not(target_os = "windows"))]
pub async fn replace_focused_text(_text: String) -> AppResult<()> {
    Err(AppError::new(
        ErrorCode::WaPanelFailed,
        "Native composer replacement is only implemented on Windows.",
    ))
}

#[cfg(target_os = "windows")]
mod windows {
    use std::{mem::size_of, ptr, thread, time::Duration};

    use windows_sys::Win32::{
        Foundation::HANDLE,
        System::{
            DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData},
            Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE},
        },
        UI::{
            Input::KeyboardAndMouse::{
                SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
                VIRTUAL_KEY, VK_A, VK_CONTROL, VK_V,
            },
            WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId},
        },
    };

    use crate::error::{AppError, AppResult, ErrorCode};

    const CF_UNICODETEXT: u32 = 13;

    struct ClipboardGuard;

    impl Drop for ClipboardGuard {
        fn drop(&mut self) {
            unsafe {
                CloseClipboard();
            }
        }
    }

    pub fn replace_focused_text(text: &str) -> AppResult<()> {
        ensure_multiconnect_is_foreground("before clipboard write")?;
        set_clipboard_text(text)?;
        thread::sleep(Duration::from_millis(40));
        ensure_multiconnect_is_foreground("before Ctrl+A")?;
        send_ctrl_chord(VK_A)?;
        thread::sleep(Duration::from_millis(40));
        ensure_multiconnect_is_foreground("before Ctrl+V")?;
        send_ctrl_chord(VK_V)?;
        Ok(())
    }

    fn ensure_multiconnect_is_foreground(stage: &str) -> AppResult<()> {
        let foreground = unsafe { GetForegroundWindow() };
        if foreground.is_null() {
            return Err(AppError::new(
                ErrorCode::WaPanelFailed,
                format!("Native input refused: no foreground window {stage}."),
            ));
        }

        let mut foreground_pid = 0_u32;
        unsafe {
            GetWindowThreadProcessId(foreground, &mut foreground_pid);
        }
        let current_pid = std::process::id();
        if foreground_pid != current_pid {
            return Err(AppError::new(
                ErrorCode::WaPanelFailed,
                format!(
                    "Native input refused: foreground window belongs to process {foreground_pid}, not MultiConnect {current_pid} {stage}."
                ),
            ));
        }

        Ok(())
    }

    fn set_clipboard_text(text: &str) -> AppResult<()> {
        let mut opened = false;
        for _ in 0..12 {
            let ok = unsafe { OpenClipboard(ptr::null_mut()) != 0 };
            if ok {
                opened = true;
                break;
            }
            thread::sleep(Duration::from_millis(25));
        }
        if !opened {
            return Err(AppError::new(
                ErrorCode::WaPanelFailed,
                "Could not open Windows clipboard.",
            ));
        }
        let _guard = ClipboardGuard;

        let mut utf16: Vec<u16> = text.encode_utf16().collect();
        utf16.push(0);
        let byte_len = utf16.len() * size_of::<u16>();
        let hmem = unsafe { GlobalAlloc(GMEM_MOVEABLE, byte_len) };
        if hmem.is_null() {
            return Err(AppError::new(
                ErrorCode::WaPanelFailed,
                "Could not allocate Windows clipboard memory.",
            ));
        }
        let locked = unsafe { GlobalLock(hmem) as *mut u16 };
        if locked.is_null() {
            return Err(AppError::new(
                ErrorCode::WaPanelFailed,
                "Could not lock Windows clipboard memory.",
            ));
        }
        unsafe {
            ptr::copy_nonoverlapping(utf16.as_ptr(), locked, utf16.len());
            GlobalUnlock(hmem);
        }

        if unsafe { EmptyClipboard() == 0 } {
            return Err(AppError::new(
                ErrorCode::WaPanelFailed,
                "Could not clear Windows clipboard.",
            ));
        }
        let handle = unsafe { SetClipboardData(CF_UNICODETEXT, hmem as HANDLE) };
        if handle.is_null() {
            return Err(AppError::new(
                ErrorCode::WaPanelFailed,
                "Could not set Windows clipboard text.",
            ));
        }
        Ok(())
    }

    fn keyboard_input(key: VIRTUAL_KEY, flags: u32) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: key,
                    wScan: 0,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    fn send_ctrl_chord(key: VIRTUAL_KEY) -> AppResult<()> {
        let inputs = [
            keyboard_input(VK_CONTROL, 0),
            keyboard_input(key, 0),
            keyboard_input(key, KEYEVENTF_KEYUP),
            keyboard_input(VK_CONTROL, KEYEVENTF_KEYUP),
        ];
        let sent = unsafe {
            SendInput(
                inputs.len() as u32,
                inputs.as_ptr(),
                size_of::<INPUT>() as i32,
            )
        };
        if sent != inputs.len() as u32 {
            return Err(AppError::new(
                ErrorCode::WaPanelFailed,
                format!("Windows SendInput sent {sent}/{} events.", inputs.len()),
            ));
        }
        Ok(())
    }
}
