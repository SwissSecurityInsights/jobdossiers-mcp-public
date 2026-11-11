// swift-tools-version:5.10
// App per la barra dei menu: chiave per automazioni nel Portachiavi, avvio all'accesso, stato delle schede.
import PackageDescription

let package = Package(
    name: "Jobdossiers",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(name: "Jobdossiers", path: "Sources/Jobdossiers"),
        .testTarget(name: "JobdossiersTests", dependencies: ["Jobdossiers"], path: "Tests/JobdossiersTests"),
    ]
)
