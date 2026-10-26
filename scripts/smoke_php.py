"""Install the extracted PHP distribution through Composer and capture a trace."""

import argparse, json, os, subprocess, tempfile
from pathlib import Path
from validate_release import tar_files

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--php", default="php")
    parser.add_argument("--composer", required=True, help="Path to composer.phar")
    parser.add_argument("--extension-dir")
    args = parser.parse_args()
    php = [str(Path(args.php).resolve()) if Path(args.php).is_file() else args.php]
    if args.extension_dir:
        php += [
            "-d",
            "extension_dir=" + str(Path(args.extension_dir).resolve()),
            "-d",
            "extension=openssl",
        ]
    composer = php + [str(Path(args.composer).resolve())]
    files = tar_files(ROOT / "dist/horus-php-sdk-0.4.0-beta.1.tar.gz")
    with tempfile.TemporaryDirectory(prefix="horus php install ") as directory:
        home = Path(directory)
        package = home / "sdk"
        package.mkdir()
        for name, data in files.items():
            path = package / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        env = {
            **os.environ,
            "COMPOSER_HOME": str(home / "composer-home"),
            "HORUS_ENDPOINT": "",
            "HORUS_SPOOL_DIR": str(home / "spool"),
        }
        subprocess.run(
            composer + ["validate", "--strict", str(package / "composer.json")],
            env=env,
            cwd=home,
            check=True,
        )
        config = {
            "name": "horus-test/consumer",
            "require": {"bugdeployer/horus-sdk": "0.4.0-beta.1"},
            "repositories": [
                {
                    "type": "path",
                    "url": str(package),
                    "options": {
                        "symlink": False,
                        "versions": {"bugdeployer/horus-sdk": "0.4.0-beta.1"},
                    },
                },
                {"packagist.org": False},
            ],
        }
        (home / "composer.json").write_text(json.dumps(config))
        subprocess.run(
            composer
            + [
                "install",
                "--no-interaction",
                "--no-dev",
                "--no-plugins",
                "--no-scripts",
            ],
            env=env,
            cwd=home,
            check=True,
        )
        (home / "capture.php").write_text("""<?php
require __DIR__.'/vendor/autoload.php';
$r = new Horus\\Recorder('installed-php', ['redaction'=>false]);
$r->trace('request', function(Horus\\Scope $s) {
    return $s->span('orders.update', ['id'=>17], function(Horus\\Scope $child) {
        $child->checkpoint('order', ['quantity'=>2]);
        return ['quantity'=>3];
    });
});
echo json_encode($r->export(), JSON_THROW_ON_ERROR);
""")
        output = subprocess.check_output(
            php + ["capture.php"], cwd=home, env=env, text=True
        )
        capture = json.loads(output)
        assert capture["application"] == "installed-php"
        assert capture["events"][-1]["kind"] == "return"
        assert any(
            e["data"].get("output") == {"quantity": 3} for e in capture["events"]
        )
        subprocess.run(
            php + [str(home / "vendor/bugdeployer/horus-sdk/worker.php"), "--once"],
            cwd=home,
            env=env,
            check=True,
        )
        print(
            "PHP package install passed: archive, Composer autoload, nested scopes, real values, and worker entry point."
        )


if __name__ == "__main__":
    main()
