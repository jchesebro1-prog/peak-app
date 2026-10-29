import Capacitor
import UIKit

/// Registers the app's own local plugins (Capacitor 8 SPM apps have no
/// auto-registration for in-app plugin classes).
class BridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(CardTextPlugin())
    }
}
