import io
import tarfile
import pytest
from scripts.validate_release import tar_files


@pytest.mark.parametrize(
    "name", ["../escape.php", "/absolute.php", "C:/escape.php", "..\\escape.php"]
)
def test_release_archive_rejects_paths_outside_package(tmp_path, name):
    archive = tmp_path / "invalid.tar.gz"
    with tarfile.open(archive, "w:gz") as target:
        item = tarfile.TarInfo(name)
        item.size = 1
        target.addfile(item, io.BytesIO(b"x"))
    with pytest.raises(ValueError, match="Unsafe archive path"):
        tar_files(archive)


def test_release_archive_rejects_links_and_duplicate_names(tmp_path):
    archive = tmp_path / "invalid.tar.gz"
    with tarfile.open(archive, "w:gz") as target:
        item = tarfile.TarInfo("package/file")
        item.type = tarfile.SYMTYPE
        item.linkname = "../../outside"
        target.addfile(item)
    with pytest.raises(ValueError, match="Unexpected archive link"):
        tar_files(archive)
    with tarfile.open(archive, "w:gz") as target:
        for _ in range(2):
            item = tarfile.TarInfo("package/file")
            item.size = 1
            target.addfile(item, io.BytesIO(b"x"))
    with pytest.raises(ValueError, match="Duplicate archive member"):
        tar_files(archive)
