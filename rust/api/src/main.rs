use rusqlite::Connection;
use std::{
    env,
    error::Error,
    sync::{Arc, Mutex},
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let path = env::var("DATABASE_PATH").unwrap_or_else(|_| "forzabot.db".into());
    // The API owns schema initialization and upgrades. Existing databases are
    // migrated in place; a fresh volume gets the full schema.
    let mut db = Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE | rusqlite::OpenFlags::SQLITE_OPEN_CREATE,
    )?;
    db.busy_timeout(std::time::Duration::from_secs(5))?;
    forzabot_database::initialize(&mut db)?;
    let addr = env::var("RUST_API_ADDR").unwrap_or_else(|_| "127.0.0.1:3001".into());
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    println!("Experimental API listening on {addr}");
    let password = env::var("POINTS_ADMIN_PASSWORD").ok();
    axum::serve(
        listener,
        forzabot_api::router_with_admin(Arc::new(Mutex::new(db)), password),
    )
    .with_graceful_shutdown(async {
        let _ = tokio::signal::ctrl_c().await;
    })
    .await?;
    Ok(())
}
