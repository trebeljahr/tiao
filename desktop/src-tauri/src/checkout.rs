#[derive(Debug, PartialEq)]
pub enum Return {
    Session(String),
    Cancelled,
}

pub fn parse(raw: &str) -> Option<Return> {
    let url = url::Url::parse(raw).ok()?;
    if url.scheme() != "tiao"
        || url.host_str() != Some("checkout")
        || !url.path().is_empty()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    let pairs: Vec<_> = url.query_pairs().collect();
    if pairs.len() != 1 {
        return None;
    }
    if pairs[0].0 == "cancelled" && pairs[0].1 == "true" {
        return Some(Return::Cancelled);
    }
    if pairs[0].0 != "session_id" {
        return None;
    }
    let value = pairs[0].1.as_ref();
    if !value.starts_with("cs_")
        || value.len() <= 3
        || value.len() > 256
        || !value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_')
    {
        return None;
    }
    Some(Return::Session(value.to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn checkout_links_only_carry_a_session_hint() {
        assert_eq!(
            parse("tiao://checkout?session_id=cs_test_123"),
            Some(Return::Session("cs_test_123".into()))
        );
        assert_eq!(
            parse("tiao://checkout?cancelled=true"),
            Some(Return::Cancelled)
        );
        for raw in [
            "https://checkout?session_id=cs_test_123",
            "tiao://user@checkout?session_id=cs_test_123",
            "tiao://checkout/path?session_id=cs_test_123",
            "tiao://checkout?session_id=cs_test_123&session_id=cs_other",
            "tiao://checkout?session_id=cs_test_123#other",
            "tiao://checkout?session_id=cs_test_%2Fother",
            "tiao://checkout?session_id=cs_",
            "tiao://checkout?cancelled=true&session_id=cs_test_123",
            "tiao://checkout?cancelled=false",
        ] {
            assert_eq!(parse(raw), None, "{raw}");
        }
    }
}
