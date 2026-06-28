import Foundation

extension Bundle {
	/// Finds the SPM resource bundle (`TobyApp_TobyApp.bundle`).
	///
	/// In development builds, `Bundle.module` works because the bundle
	/// sits in the build output directory.  In a packaged `.app` the
	/// bundle lives in `Contents/Resources/`, which `Bundle.module`
	/// does not check.  This accessor tries `Bundle.main` first (which
	/// searches `Contents/Resources/` for `.app` bundles) and falls
	/// back to `Bundle.module` for dev builds.
	static var tobyResources: Bundle {
		if let url = Bundle.main.url(forResource: "TobyApp_TobyApp", withExtension: "bundle"),
			let bundle = Bundle(url: url)
		{
			return bundle
		}
		return Bundle.module
	}
}
