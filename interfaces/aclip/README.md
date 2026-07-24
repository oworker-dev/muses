# ACLIP Interface

This directory describes the CLI command surface that Agents can use to call the SaaS Starter programmable service boundary.

The default CLI is intentionally small. It calls the Hono API and returns JSON, which keeps Agent behavior stable without coupling Agents to the human Web UI.
