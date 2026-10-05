{
  "targets": [
    {
      "target_name": "tiao_msstore",
      "conditions": [
        [
          "OS=='win'",
          {
            "sources": ["src/msstore.cc"],
            "defines": ["NOMINMAX", "WIN32_LEAN_AND_MEAN", "NAPI_VERSION=8"],
            "libraries": ["WindowsApp.lib"],
            "msvs_settings": {
              "VCCLCompilerTool": {
                "ExceptionHandling": 1,
                "AdditionalOptions": ["/std:c++20", "/permissive-", "/bigobj"]
              }
            }
          }
        ]
      ]
    }
  ]
}
