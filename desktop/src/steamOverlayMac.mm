#import <Cocoa/Cocoa.h>
#import <MetalKit/MetalKit.h>
#include <node_api.h>
#include <cstring>

// Chromium presents IOSurfaces through Core Animation on macOS. Steam's
// Metal hooks need a drawable presented by this process. A transparent
// surface above the web view supplies one without copying the game frames.
@interface TiaoOverlayView : MTKView
@end
@implementation TiaoOverlayView
- (BOOL)isOpaque { return NO; }
- (NSView *)hitTest:(NSPoint)point { return nil; }
@end

@interface TiaoOverlaySurface : NSObject <MTKViewDelegate>
@property(strong) TiaoOverlayView *view;
@property(strong) id<MTLCommandQueue> queue;
- (instancetype)initWithHost:(NSView *)host;
- (void)stop;
@end

@implementation TiaoOverlaySurface
- (instancetype)initWithHost:(NSView *)host {
  self = [super init];
  if (!self) return nil;
  id<MTLDevice> device = MTLCreateSystemDefaultDevice();
  if (!device) return nil;
  self.queue = [device newCommandQueue];
  if (!self.queue) return nil;
  self.view = [[TiaoOverlayView alloc] initWithFrame:host.bounds device:device];
  self.view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  self.view.clearColor = MTLClearColorMake(0, 0, 0, 0);
  self.view.colorPixelFormat = MTLPixelFormatBGRA8Unorm;
  self.view.layer.opaque = NO;
  self.view.preferredFramesPerSecond = 60;
  self.view.delegate = self;
  [host addSubview:self.view positioned:NSWindowAbove relativeTo:nil];
  return self;
}
- (void)drawInMTKView:(MTKView *)view {
  @autoreleasepool {
    // Steam can mark the game occluded while opening its overlay. It still
    // needs presents to draw that overlay, so only stop for hidden/minimized
    // windows, not for an ordered-in window covered by Steam.
    if (!view.window.visible || view.window.miniaturized) return;
    id<CAMetalDrawable> drawable = view.currentDrawable;
    MTLRenderPassDescriptor *pass = view.currentRenderPassDescriptor;
    if (!drawable || !pass) return;
    id<MTLCommandBuffer> commands = [self.queue commandBuffer];
    id<MTLRenderCommandEncoder> encoder = [commands renderCommandEncoderWithDescriptor:pass];
    [encoder endEncoding];
    [commands presentDrawable:drawable];
    [commands commit];
  }
}
- (void)mtkView:(MTKView *)view drawableSizeWillChange:(CGSize)size {}
- (void)stop {
  self.view.paused = YES;
  self.view.delegate = nil;
  [self.view removeFromSuperview];
  self.view = nil;
  self.queue = nil;
}
@end

struct OverlayHandle {
  __strong TiaoOverlaySurface *surface;
};

static void Finalize(napi_env env, void *data, void *hint) {
  auto *handle = static_cast<OverlayHandle *>(data);
  if ([NSThread isMainThread]) {
    [handle->surface stop];
    delete handle;
  } else {
    dispatch_async(dispatch_get_main_queue(), ^{
      [handle->surface stop];
      delete handle;
    });
  }
}

static napi_value Attach(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  bool isBuffer = false;
  if (argc != 1 || napi_is_buffer(env, argv[0], &isBuffer) != napi_ok || !isBuffer) {
    napi_throw_type_error(env, nullptr, "Expected the native window handle Buffer");
    return nullptr;
  }
  void *bytes = nullptr;
  size_t size = 0;
  napi_get_buffer_info(env, argv[0], &bytes, &size);
  if (size != sizeof(void *) || ![NSThread isMainThread]) {
    napi_throw_error(env, nullptr, "Overlay attachment requires a native window on the main thread");
    return nullptr;
  }
  void *pointer = nullptr;
  std::memcpy(&pointer, bytes, sizeof(pointer));
  NSView *view = (__bridge NSView *)pointer;
  NSView *host = view.window.contentView;
  if (!host) {
    napi_throw_error(env, nullptr, "Native window has no content view");
    return nullptr;
  }
  TiaoOverlaySurface *surface = [[TiaoOverlaySurface alloc] initWithHost:host];
  if (!surface) {
    napi_throw_error(env, nullptr, "Could not create the Metal overlay surface");
    return nullptr;
  }
  auto *handle = new OverlayHandle{surface};
  napi_value external;
  napi_create_external(env, handle, Finalize, nullptr, &external);
  return external;
}

static napi_value Detach(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  void *data = nullptr;
  if (argc != 1 || napi_get_value_external(env, argv[0], &data) != napi_ok || ![NSThread isMainThread]) {
    napi_throw_type_error(env, nullptr, "Expected an overlay handle on the main thread");
    return nullptr;
  }
  auto *handle = static_cast<OverlayHandle *>(data);
  [handle->surface stop];
  handle->surface = nil;
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

NAPI_MODULE_INIT() {
  napi_property_descriptor methods[] = {
    {"attach", nullptr, Attach, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"detach", nullptr, Detach, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, 2, methods);
  return exports;
}
