use std::io::{self, Read};
use swagger_engine::{Profile, SwaggerModel};

fn main() -> io::Result<()> {
    let invalid = || {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "An explicit valid Swagger profile is required",
        )
    };
    let mut arguments = std::env::args_os().skip(1);
    let path = arguments.next().ok_or_else(invalid)?;
    if arguments.next().is_some() {
        return Err(invalid());
    }
    let file = std::fs::File::open(path).map_err(|_| invalid())?;
    let mut bytes = Vec::new();
    file.take(262145)
        .read_to_end(&mut bytes)
        .map_err(|_| invalid())?;
    if bytes.len() > 262144 {
        return Err(invalid());
    }
    let profile: Profile = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
    let model = SwaggerModel::new(profile).map_err(|_| invalid())?;
    daedlo_engine::serve(model)
}
