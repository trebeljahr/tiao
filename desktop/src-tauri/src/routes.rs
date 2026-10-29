use std::{borrow::Cow, marker::PhantomData};
use tauri::{
    utils::assets::{AssetKey, AssetsIter, CspHash},
    Assets, Context, Runtime,
};

// Same route contract as the web export and Capacitor's native routers.
fn resolve(path: &str, exists: impl Fn(&str) -> bool) -> String {
    let parts: Vec<_> = path.split('/').filter(|part| !part.is_empty()).collect();
    if parts.is_empty()
        || parts
            .iter()
            .any(|p| *p == "." || *p == ".." || p.contains(['\\', '\0']))
    {
        return "/index.html".into();
    }
    let file = parts.last().unwrap().contains('.');
    let mut bases = vec![parts.clone()];
    if !["en", "de", "es"].contains(&parts[0]) {
        let mut base = vec!["en"];
        base.extend(&parts);
        bases.push(base);
    }
    let name = |base: &[&str]| {
        if file {
            format!("/{}", base.join("/"))
        } else {
            format!("/{}/index.html", base.join("/"))
        }
    };
    for mut base in bases {
        let exact = name(&base);
        if exists(&exact) {
            return exact;
        }
        let param = if base.get(1) == Some(&"embed") && base.get(2) == Some(&"game") {
            3
        } else if base
            .get(1)
            .is_some_and(|p| ["game", "profile", "tournament"].contains(p))
        {
            2
        } else {
            continue;
        };
        if param < base.len() - usize::from(file) {
            base[param] = "__spa__";
            let candidate = name(&base);
            if exists(&candidate) {
                return candidate;
            }
        }
    }
    if file {
        format!("/{}", parts.join("/"))
    } else {
        "/index.html".into()
    }
}
struct Routed<R: Runtime> {
    inner: Box<dyn Assets<R>>,
}
impl<R: Runtime> Routed<R> {
    fn key(&self, key: &AssetKey) -> AssetKey {
        AssetKey::from(resolve(key.as_ref(), |path| {
            self.inner.get(&AssetKey::from(path)).is_some()
        }))
    }
}
impl<R: Runtime> Assets<R> for Routed<R> {
    fn setup(&self, app: &tauri::App<R>) {
        self.inner.setup(app);
    }
    fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        // Chunks and other exact assets need one lookup/decompression only.
        if let Some(bytes) = self.inner.get(key) {
            return Some(bytes);
        }
        self.inner.get(&self.key(key))
    }
    fn iter(&self) -> Box<AssetsIter<'_>> {
        self.inner.iter()
    }
    fn csp_hashes(&self, key: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        self.inner.csp_hashes(&self.key(key))
    }
}
struct Empty<R>(PhantomData<fn() -> R>);
impl<R: Runtime> Assets<R> for Empty<R> {
    fn get(&self, _: &AssetKey) -> Option<Cow<'_, [u8]>> {
        None
    }
    fn iter(&self) -> Box<AssetsIter<'_>> {
        Box::new(std::iter::empty())
    }
    fn csp_hashes(&self, _: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        Box::new(std::iter::empty())
    }
}
pub fn install<R: Runtime>(context: &mut Context<R>) {
    let inner = context.set_assets(Box::new(Empty(PhantomData)));
    context.set_assets(Box::new(Routed { inner }));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shared_route_fixtures() {
        let text = include_str!("../../../mobile/scripts/routes-cases.txt");
        let files: Vec<_> = text
            .lines()
            .filter_map(|line| line.strip_prefix("F "))
            .collect();
        for line in text.lines().filter_map(|line| line.strip_prefix("C ")) {
            let fields: Vec<_> = line.split_whitespace().collect();
            assert_eq!(
                resolve(fields[0], |path| files.contains(&path)),
                fields[1],
                "{line}"
            );
        }
    }
}
