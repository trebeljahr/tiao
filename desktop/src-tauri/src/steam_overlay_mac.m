#import <AppKit/AppKit.h>
#import <MetalKit/MetalKit.h>

extern bool tiao_overlay_needs_present(void);

// WKWebView presents in a separate GPU process. Steam needs a drawable in
// this process to composite its own UI. Keep it below WebKit while closed:
// an always-above Metal layer can make WebKit suspend its rendering.
@interface TiaoOverlayView : MTKView
@end

@implementation TiaoOverlayView
- (BOOL)isOpaque { return NO; }
- (BOOL)acceptsFirstResponder { return NO; }
- (NSView *)hitTest:(NSPoint)point { return nil; }
@end

@interface TiaoOverlaySurface : NSObject <MTKViewDelegate>
@property(strong) TiaoOverlayView *view;
@property(strong) id<MTLCommandQueue> queue;
@property(nonatomic) NSUInteger failedFrames;
@property(nonatomic) NSUInteger bootstrapFrames;
@property(nonatomic) BOOL loggedIdle;
- (instancetype)initWithWindow:(NSWindow *)window;
- (void)stop;
@end

@implementation TiaoOverlaySurface
- (instancetype)initWithWindow:(NSWindow *)window {
    self = [super init];
    if (!self) return nil;
    NSView *host = window.contentView;
    id<MTLDevice> device = MTLCreateSystemDefaultDevice();
    if (!host || !device) return nil;
    self.queue = [device newCommandQueue];
    if (!self.queue) return nil;
    self.view = [[TiaoOverlayView alloc] initWithFrame:host.bounds device:device];
    self.view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    self.view.clearColor = MTLClearColorMake(0, 0, 0, 0);
    self.view.colorPixelFormat = MTLPixelFormatBGRA8Unorm;
    self.view.layer.opaque = NO;
    self.view.accessibilityElement = NO;
    self.view.accessibilityChildren = @[];
    self.view.preferredFramesPerSecond = 60;
    self.view.delegate = self;
    self.bootstrapFrames = 60;
    [host addSubview:self.view positioned:NSWindowBelow relativeTo:nil];
    return self;
}
- (void)drawInMTKView:(MTKView *)view {
    @autoreleasepool {
        // Steam activation can occlude WebKit before its overlay has drawn.
        // Keep providing presents in that state so the overlay can appear.
        if (!view.window.visible || view.window.miniaturized) return;
        // Establish Steam's render hook before relying on its demand signal.
        // Afterwards keep polling, but avoid redundant full-window GPU work.
        if (self.bootstrapFrames == 0 && !tiao_overlay_needs_present()) {
            if (!self.loggedIdle) {
                NSLog(@"Steam overlay surface idle; skipping GPU presents");
                self.loggedIdle = YES;
            }
            return;
        }
        id<CAMetalDrawable> drawable = view.currentDrawable;
        MTLRenderPassDescriptor *pass = view.currentRenderPassDescriptor;
        if (!drawable || !pass) {
            if (++self.failedFrames >= 120) {
                NSLog(@"Steam overlay Metal presentation failed; removing the surface");
                [self stop];
            }
            return;
        }
        id<MTLCommandBuffer> commands = [self.queue commandBuffer];
        if (!commands) return;
        id<MTLRenderCommandEncoder> encoder = [commands renderCommandEncoderWithDescriptor:pass];
        if (!encoder) return;
        [encoder endEncoding];
        [commands presentDrawable:drawable];
        [commands commit];
        if (self.bootstrapFrames > 0) --self.bootstrapFrames;
        self.failedFrames = 0;
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

// Single main game window; every entry point is called on Tauri's main thread.
static TiaoOverlaySurface *surface;

bool tiao_overlay_attach(void *nativeWindow) {
    if (![NSThread isMainThread] || !nativeWindow) return false;
    if (surface) return true;
    NSWindow *window = (__bridge NSWindow *)nativeWindow;
    surface = [[TiaoOverlaySurface alloc] initWithWindow:window];
    return surface != nil;
}

void tiao_overlay_set_active(bool active) {
    if (![NSThread isMainThread] || !surface.view) return;
    NSView *host = surface.view.superview;
    [host addSubview:surface.view
         positioned:active ? NSWindowAbove : NSWindowBelow
         relativeTo:nil];
}

void tiao_overlay_stop(void) {
    if (![NSThread isMainThread]) return;
    [surface stop];
    surface = nil;
}
