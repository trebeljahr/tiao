// Windows.Services.Store bridge for the Microsoft Store build of Tiao.
//
// Three calls, all returning Promises:
//
//   getAddOns()                                → [{ storeId, inAppOfferToken, title,
//                                                   formattedPrice, isInUserCollection }]
//   requestPurchase(storeId, hwndBuffer)       → { status, extendedError }
//   getCustomerCollectionsId(ticket, userId)   → string (Microsoft Store ID key)
//
// Only meaningful inside a packaged MSIX/AppX: StoreContext needs package
// identity, and an unpackaged process gets errors from every call.
//
// Desktop (Win32) apps have no CoreWindow, so the purchase dialog must be
// parented with IInitializeWithWindow before RequestPurchaseAsync; the
// Electron main process passes BrowserWindow.getNativeWindowHandle().
//
// WinRT async operations are awaited with .get() on the libuv thread pool
// (initialized as MTA), never on the JS thread.

#include <unknwn.h>
#include <shobjidl_core.h>

#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Services.Store.h>

#include <node_api.h>

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

using winrt::Windows::Services::Store::StoreContext;
using winrt::Windows::Services::Store::StoreProduct;
using winrt::Windows::Services::Store::StorePurchaseStatus;

namespace {

std::string HrToString(int32_t hr) {
  char buf[16];
  std::snprintf(buf, sizeof(buf), "0x%08X", static_cast<uint32_t>(hr));
  return buf;
}

struct Work {
  napi_async_work work = nullptr;
  napi_deferred deferred = nullptr;
  std::string error;
  virtual ~Work() = default;
  // Thread pool: no napi calls allowed here.
  virtual void Run() = 0;
  // JS thread.
  virtual napi_value Result(napi_env env) = 0;
};

void ExecuteWork(napi_env /*env*/, void* data) {
  auto* w = static_cast<Work*>(data);
  try {
    winrt::init_apartment(winrt::apartment_type::multi_threaded);
  } catch (...) {
    // Pool thread already joined an apartment on an earlier call.
  }
  try {
    w->Run();
  } catch (winrt::hresult_error const& e) {
    w->error = winrt::to_string(e.message());
    w->error += " (" + HrToString(static_cast<int32_t>(e.code())) + ")";
  } catch (std::exception const& e) {
    w->error = e.what();
  } catch (...) {
    w->error = "unknown native error";
  }
}

void CompleteWork(napi_env env, napi_status status, void* data) {
  std::unique_ptr<Work> w(static_cast<Work*>(data));
  if (status != napi_ok || !w->error.empty()) {
    napi_value msg;
    napi_value err;
    napi_create_string_utf8(env, w->error.empty() ? "cancelled" : w->error.c_str(),
                            NAPI_AUTO_LENGTH, &msg);
    napi_create_error(env, nullptr, msg, &err);
    napi_reject_deferred(env, w->deferred, err);
  } else {
    napi_resolve_deferred(env, w->deferred, w->Result(env));
  }
  napi_delete_async_work(env, w->work);
}

napi_value Queue(napi_env env, Work* w, const char* name) {
  napi_value promise;
  napi_value resource;
  napi_create_promise(env, &w->deferred, &promise);
  napi_create_string_utf8(env, name, NAPI_AUTO_LENGTH, &resource);
  napi_create_async_work(env, nullptr, resource, ExecuteWork, CompleteWork, w, &w->work);
  napi_queue_async_work(env, w->work);
  return promise;
}

napi_value Throw(napi_env env, const char* message) {
  napi_throw_type_error(env, nullptr, message);
  return nullptr;
}

bool GetString(napi_env env, napi_value value, std::string* out) {
  size_t len = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &len) != napi_ok) return false;
  out->resize(len);
  size_t written = 0;
  if (napi_get_value_string_utf8(env, value, out->data(), len + 1, &written) != napi_ok) {
    return false;
  }
  out->resize(written);
  return true;
}

napi_value Str(napi_env env, std::string const& s) {
  napi_value v;
  napi_create_string_utf8(env, s.c_str(), s.size(), &v);
  return v;
}

void SetProp(napi_env env, napi_value obj, const char* key, napi_value value) {
  napi_set_named_property(env, obj, key, value);
}

// ── getAddOns ──────────────────────────────────────────────────────────────

struct AddOn {
  std::string storeId;
  std::string inAppOfferToken;
  std::string title;
  std::string formattedPrice;
  bool isInUserCollection = false;
};

struct GetAddOnsWork : Work {
  std::vector<AddOn> items;

  void Run() override {
    StoreContext ctx = StoreContext::GetDefault();
    auto kinds = winrt::single_threaded_vector<winrt::hstring>(
        std::vector<winrt::hstring>{L"Durable"});
    auto result = ctx.GetAssociatedStoreProductsAsync(kinds).get();
    const int32_t hr = static_cast<int32_t>(result.ExtendedError());
    if (hr < 0) {
      error = "GetAssociatedStoreProductsAsync failed (" + HrToString(hr) + ")";
      return;
    }
    for (auto const& kv : result.Products()) {
      StoreProduct p = kv.Value();
      AddOn a;
      a.storeId = winrt::to_string(p.StoreId());
      a.inAppOfferToken = winrt::to_string(p.InAppOfferToken());
      a.title = winrt::to_string(p.Title());
      a.formattedPrice = winrt::to_string(p.Price().FormattedPrice());
      a.isInUserCollection = p.IsInUserCollection();
      items.push_back(std::move(a));
    }
  }

  napi_value Result(napi_env env) override {
    napi_value arr;
    napi_create_array_with_length(env, items.size(), &arr);
    for (size_t i = 0; i < items.size(); i++) {
      napi_value o;
      napi_create_object(env, &o);
      SetProp(env, o, "storeId", Str(env, items[i].storeId));
      SetProp(env, o, "inAppOfferToken", Str(env, items[i].inAppOfferToken));
      SetProp(env, o, "title", Str(env, items[i].title));
      SetProp(env, o, "formattedPrice", Str(env, items[i].formattedPrice));
      napi_value owned;
      napi_get_boolean(env, items[i].isInUserCollection, &owned);
      SetProp(env, o, "isInUserCollection", owned);
      napi_set_element(env, arr, static_cast<uint32_t>(i), o);
    }
    return arr;
  }
};

napi_value GetAddOns(napi_env env, napi_callback_info /*info*/) {
  return Queue(env, new GetAddOnsWork(), "tiao_msstore.getAddOns");
}

// ── requestPurchase ────────────────────────────────────────────────────────

struct PurchaseWork : Work {
  std::string storeId;
  HWND hwnd = nullptr;
  StorePurchaseStatus status = StorePurchaseStatus::ServerError;
  int32_t extendedError = 0;

  void Run() override {
    StoreContext ctx = StoreContext::GetDefault();
    auto init = ctx.as<::IInitializeWithWindow>();
    winrt::check_hresult(init->Initialize(hwnd));
    auto result = ctx.RequestPurchaseAsync(winrt::to_hstring(storeId)).get();
    status = result.Status();
    extendedError = static_cast<int32_t>(result.ExtendedError());
  }

  napi_value Result(napi_env env) override {
    const char* name = "serverError";
    switch (status) {
      case StorePurchaseStatus::Succeeded: name = "succeeded"; break;
      case StorePurchaseStatus::AlreadyPurchased: name = "alreadyPurchased"; break;
      case StorePurchaseStatus::NotPurchased: name = "notPurchased"; break;
      case StorePurchaseStatus::NetworkError: name = "networkError"; break;
      case StorePurchaseStatus::ServerError: name = "serverError"; break;
    }
    napi_value o;
    napi_create_object(env, &o);
    SetProp(env, o, "status", Str(env, name));
    SetProp(env, o, "extendedError", Str(env, extendedError < 0 ? HrToString(extendedError) : ""));
    return o;
  }
};

napi_value RequestPurchase(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 2) return Throw(env, "requestPurchase(storeId, hwndBuffer) needs two arguments");

  auto work = std::make_unique<PurchaseWork>();
  if (!GetString(env, argv[0], &work->storeId) || work->storeId.empty()) {
    return Throw(env, "storeId must be a non-empty string");
  }
  bool isBuffer = false;
  napi_is_buffer(env, argv[1], &isBuffer);
  if (!isBuffer) return Throw(env, "hwndBuffer must be a Buffer");
  void* data = nullptr;
  size_t length = 0;
  napi_get_buffer_info(env, argv[1], &data, &length);
  if (length < sizeof(HWND)) return Throw(env, "hwndBuffer is too short");
  std::memcpy(&work->hwnd, data, sizeof(HWND));

  return Queue(env, work.release(), "tiao_msstore.requestPurchase");
}

// ── getCustomerCollectionsId ───────────────────────────────────────────────

struct CollectionsIdWork : Work {
  std::string serviceTicket;
  std::string publisherUserId;
  std::string key;

  void Run() override {
    StoreContext ctx = StoreContext::GetDefault();
    auto id = ctx.GetCustomerCollectionsIdAsync(winrt::to_hstring(serviceTicket),
                                                winrt::to_hstring(publisherUserId))
                  .get();
    key = winrt::to_string(id);
    // An empty key means the Store rejected the ticket or nobody is signed
    // in to the Store app.
    if (key.empty()) error = "GetCustomerCollectionsIdAsync returned an empty key";
  }

  napi_value Result(napi_env env) override { return Str(env, key); }
};

napi_value GetCustomerCollectionsId(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 2) return Throw(env, "getCustomerCollectionsId(ticket, userId) needs two arguments");
  auto work = std::make_unique<CollectionsIdWork>();
  if (!GetString(env, argv[0], &work->serviceTicket) || work->serviceTicket.empty()) {
    return Throw(env, "serviceTicket must be a non-empty string");
  }
  if (!GetString(env, argv[1], &work->publisherUserId)) {
    return Throw(env, "publisherUserId must be a string");
  }
  return Queue(env, work.release(), "tiao_msstore.getCustomerCollectionsId");
}

napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor props[] = {
      {"getAddOns", nullptr, GetAddOns, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"requestPurchase", nullptr, RequestPurchase, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"getCustomerCollectionsId", nullptr, GetCustomerCollectionsId, nullptr, nullptr, nullptr,
       napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
