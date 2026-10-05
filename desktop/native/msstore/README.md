# tiao-msstore

Windows.Services.Store bridge for the Microsoft Store (AppX/MSIX) build.
A small C++/WinRT N-API addon; `desktop/src/msstore.cjs` is the only caller.

| Export | WinRT call |
| --- | --- |
| `getAddOns()` | `StoreContext.GetAssociatedStoreProductsAsync(["Durable"])` |
| `requestPurchase(storeId, hwnd)` | `IInitializeWithWindow::Initialize` + `StoreContext.RequestPurchaseAsync` |
| `getCustomerCollectionsId(ticket, userId)` | `StoreContext.GetCustomerCollectionsIdAsync` |

## Build

Built only by the `msstore` leg of `.github/workflows/build-desktop.yml`, on
`windows-latest` (MSVC + Windows SDK, which ships the C++/WinRT headers):

```powershell
npx node-gyp@13.1.0 rebuild --target=<electron version> --arch=x64 --dist-url=https://electronjs.org/headers
```

`scripts/release/builder-config.cjs` adds `build/Release/tiao_msstore.node`
to the msstore package only, unpacked from the asar. On macOS and Linux the
gyp target has no sources, and no other channel loads the addon.

## Testing

`StoreContext` needs package identity, so the calls fail outside an
installed AppX. To try purchases, sideload the AppX built by CI with the
Partner Center identity, on a PC signed in to a Microsoft account listed
as a tester for the add-ons (or with the add-ons published), then open the
shop. The JS wrapper is unit-tested against a fake addon
(`src/msstore.test.cjs`).

Not yet verified on hardware: whether `RequestPurchaseAsync` called from a
libuv worker thread (MTA) shows the dialog correctly parented. If it does
not, move the call to the main thread with a thread-safe function.
