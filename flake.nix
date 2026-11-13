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
          dev = pkgs.writeShellApplication {
            name = "jeopardy-dev";
            runtimeInputs = [ pkgs.nodejs_24 ];
            text = ''
              if [[ ! -f backend/package-lock.json || ! -f frontend/package-lock.json ]]; then
                echo "Run this command from the Jeopardy repository directory." >&2
                exit 1
              fi

              npm ci --prefix backend
              npm ci --prefix frontend

              # Separate process groups let cleanup stop npm and its watchers.
              set -m
              backend_pid=""
              frontend_pid=""
              cleanup() {
                trap - EXIT INT TERM
                if [[ -n "$backend_pid" ]]; then kill -- "-$backend_pid" 2>/dev/null || true; fi
                if [[ -n "$frontend_pid" ]]; then kill -- "-$frontend_pid" 2>/dev/null || true; fi
                wait || true
              }
              trap cleanup EXIT
              trap 'exit 130' INT
              trap 'exit 143' TERM

              echo "Starting development servers. Open http://localhost:3001 (Ctrl+C stops both)."
              PORT=3002 npm run dev --prefix backend &
              backend_pid=$!
              npm run dev --prefix frontend -- --strictPort &
              frontend_pid=$!
              # If either server exits, stop the other as well.
              wait -n "$backend_pid" "$frontend_pid"
            '';
          };
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
        dev = {
          type = "app";
          meta.description = "Run backend and frontend with live reload";
          program = "${self.packages.${system}.dev}/bin/jeopardy-dev";
        };
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
