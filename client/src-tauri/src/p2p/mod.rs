//! Peer-to-peer transport: Nostr signaling, WebRTC star around the presenter, ICE/TURN config,
//! admission (approval / PIN) and permanent rooms waiting for remote access.

pub mod admission;
pub mod hub;
pub mod lobby;
pub mod signal;
pub mod turn;
