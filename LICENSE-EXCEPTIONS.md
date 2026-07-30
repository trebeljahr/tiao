# Additional permissions under AGPL-3.0 section 7

Tiao is licensed under the GNU Affero General Public License, version 3
(see [LICENSE](LICENSE)). The following additional permission applies on
top of it.

The AGPL text itself must be distributed verbatim, which is why this
grant lives in its own file rather than being folded into `LICENSE`.

## Steamworks SDK linking exception

> Additional permission under GNU AGPL version 3 section 7
>
> If you modify this Program, or any covered work, by linking or
> combining it with the Steamworks SDK (or a modified version of that
> library), containing parts covered by the terms of the Valve
> Corporation Steamworks SDK Access Agreement, the licensors of this
> Program grant you additional permission to convey the resulting work.
> Corresponding Source for a non-source form of such a combination shall
> include the source code for the parts of the Steamworks SDK used as
> well as that of the covered work.

## Why this exists

The desktop build links against the Steamworks SDK, via the
[`steamworks.js`](https://github.com/ceifa/steamworks.js) binding, to
provide achievements and the Steam overlay.

`steamworks.js` is itself permissively licensed, but the Steamworks SDK
it wraps is proprietary and distributed under Valve's own agreement. The
AGPL requires that the complete corresponding source of a conveyed work
be available under the AGPL, and the SDK's source cannot be relicensed
that way. Without this exception, distributing a Steam build of Tiao
would be a license violation — not because of anything Valve does, but
because the AGPL and the SDK's terms cannot both be satisfied at once.

Section 7 of the AGPL exists precisely for this: it lets the copyright
holder grant additional permissions that relax the license's
requirements for a specific combination.

This permission is limited to the Steamworks SDK. Every other
obligation of the AGPL — source availability, the network-use clause,
copyleft on derivative works — is unaffected.

## Scope and contributions

The permission above is granted by the copyright holders of Tiao. As of
this writing that is Rico Trebeljahr, the sole author of the covered
work.

Contributions are accepted under the AGPL-3.0 **and** this exception.
Opening a pull request means agreeing that your contribution may be
distributed under both. This matters more than it looks: if a
contributor's code were AGPL-only, the exception would no longer cover
the whole work, and the Steam build would become undistributable again
until that code was removed or relicensed.
