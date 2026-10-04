# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# ── Capacitor bridge ─────────────────────────────────────────
# Capacitor plugins are invoked from JavaScript by their class name
# + annotated method name, using reflection. R8 must not rename
# any of this or the JS side of the bridge starts crashing at
# runtime with ClassNotFoundException.

-keep class com.getcapacitor.** { *; }
-keep class com.capacitorjs.** { *; }
-keep class * extends com.getcapacitor.Plugin { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod <methods>;
    @com.getcapacitor.annotation.PluginMethod <methods>;
}

# Our own MainActivity subclass is referenced by name in the Android
# manifest, so R8 already keeps it — no extra rule needed. But if a
# future plugin adds its own Activity/Service/Receiver, add a
# `-keep class com.ricoslabs.tiao.YourClass` rule here.

# ── WebView JS interface ────────────────────────────────────
# Anything exposed to JS via @JavascriptInterface must keep its
# public method signatures.

-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# ── Reasonable stack traces ─────────────────────────────────
# Keep source file + line numbers so crash reports from the Play
# Console are readable. Rename the file name to "SourceFile" since
# we don't want the original package paths in public traces.

-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
