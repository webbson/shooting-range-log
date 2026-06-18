//! Passphrase-based encryption via the `age` crate (scrypt KDF).
//! Encrypted artifacts carry the salt and work-factor inside the header, so
//! decryption only requires the passphrase — no key file needed.

use std::io::{Read, Write};

use age::secrecy::SecretString;

use crate::error::AppError;

pub fn encrypt(data: &[u8], passphrase: &str) -> Result<Vec<u8>, AppError> {
    let secret = SecretString::from(passphrase.to_owned());
    let encryptor = age::Encryptor::with_user_passphrase(secret);
    let mut output: Vec<u8> = vec![];
    let mut writer = encryptor
        .wrap_output(&mut output)
        .map_err(|e| AppError::new("err_encrypt_failed", format!("encrypt init: {e}"), serde_json::json!({})))?;
    writer
        .write_all(data)
        .map_err(|e| AppError::new("err_encrypt_failed", format!("encrypt write: {e}"), serde_json::json!({})))?;
    writer
        .finish()
        .map_err(|e| AppError::new("err_encrypt_failed", format!("encrypt finish: {e}"), serde_json::json!({})))?;
    Ok(output)
}

pub fn decrypt(data: &[u8], passphrase: &str) -> Result<Vec<u8>, AppError> {
    let decryptor =
        age::Decryptor::new_buffered(std::io::BufReader::new(data)).map_err(|e| {
            AppError::new(
                "err_decrypt_failed",
                format!("decrypt init: {e}"),
                serde_json::json!({}),
            )
        })?;

    if !decryptor.is_scrypt() {
        return Err(AppError::new(
            "err_decrypt_failed",
            "Backup was not encrypted with a passphrase",
            serde_json::json!({}),
        ));
    }

    let secret = SecretString::from(passphrase.to_owned());
    let identity = age::scrypt::Identity::new(secret);
    let mut reader = decryptor
        .decrypt(std::iter::once(&identity as &dyn age::Identity))
        .map_err(|e| {
            AppError::new(
                "err_decrypt_failed",
                format!("decrypt: {e}"),
                serde_json::json!({}),
            )
        })?;
    let mut output: Vec<u8> = vec![];
    reader
        .read_to_end(&mut output)
        .map_err(|e| AppError::new("err_decrypt_failed", format!("decrypt read: {e}"), serde_json::json!({})))?;
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let plaintext = b"this is a test payload for the shooting range log backup";
        let passphrase = "correct horse battery staple";
        let ciphertext = encrypt(plaintext, passphrase).unwrap();
        assert_ne!(ciphertext, plaintext, "ciphertext must differ from plaintext");
        let recovered = decrypt(&ciphertext, passphrase).unwrap();
        assert_eq!(recovered, plaintext);
    }

    #[test]
    fn wrong_passphrase_fails() {
        let plaintext = b"sensitive data";
        let ciphertext = encrypt(plaintext, "right-pass").unwrap();
        let result = decrypt(&ciphertext, "wrong-pass");
        assert!(result.is_err());
    }
}
