import Capacitor
import UIKit

/// Serves each route's own page from the static export instead of
/// Capacitor's single-page fallback. See `TiaoRoutes`.
struct TiaoRouter: Router {
    var basePath: String = ""

    func route(for path: String) -> String {
        let root = basePath
        return root + TiaoRoutes.resolve(path) { FileManager.default.fileExists(atPath: root + $0) }
    }
}

class MainViewController: CAPBridgeViewController {
    override func router() -> Router {
        return TiaoRouter()
    }
}
