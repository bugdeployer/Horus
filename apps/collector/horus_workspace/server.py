"""Local workspace entry point."""

import argparse
import uvicorn


def main():
    parser = argparse.ArgumentParser(description="Run the Horus workspace")
    parser.add_argument("--port", type=int, default=3100)
    args = parser.parse_args()
    uvicorn.run("horus_workspace.main:app", host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
