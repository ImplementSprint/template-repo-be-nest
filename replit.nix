{ pkgs }:

let
  # Runtime selector (primary knob):
  # Keep aligned with Dockerfile/CI unless intentionally diverging.
  # Common options: pkgs.nodejs_20, pkgs.nodejs_22
  runtime = pkgs.nodejs_22;

  # Enable a small default tooling set for diagnostics/scripts in Replit.
  includeCommonTools = true;

  commonTools = with pkgs; [
    bash
    curl
    git
    jq
  ];

  # Optional project-specific dependencies.
  # Examples: pkgs.openssl, pkgs.python311, pkgs.postgresql
  extraDeps = [
  ];
in
{
  deps =
    [ runtime ]
    ++ (if includeCommonTools then commonTools else [ ])
    ++ extraDeps;
}
