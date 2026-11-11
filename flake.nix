{
  description = "Run and develop the Jeopardy game locally";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      packages = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        {
          default = pkgs.writeShellApplication {
            name = "jeopardy";
            runtimeInputs = [ pkgs.nodejs_24 ];
            text = ''
              if [[ ! -f backend/package-lock.json || ! -f frontend/package-lock.json ]]; then
                echo "Run this command from the Jeopardy repository directory." >&2
                exit 1
              fi

              npm ci --prefix backend
              npm ci --prefix frontend
              npm run build
              exec npm start
            '';
          };
        });

      apps = forAllSystems (system: {
        default = {
          type = "app";
          meta.description = "Build and serve the current Jeopardy checkout";
          program = "${self.packages.${system}.default}/bin/jeopardy";
        };
      });

      devShells = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        {
          default = pkgs.mkShellNoCC {
            packages = [ pkgs.nodejs_24 ];
          };
        });
    };
}
