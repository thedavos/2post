"""Brand asset inventory and rendered head metadata."""

from pathlib import Path

import pytest
from django.template.loader import render_to_string
from django.test import Client, RequestFactory
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]

BRAND_ASSETS = {
    "static/img/2post-logo.webp": (476, 476),
    ".github/assets/2post-logo.webp": (476, 476),
    "static/img/2post-mark.webp": (256, 256),
    "static/favicon/favicon-96x96.png": (96, 96),
    "static/favicon/apple-touch-icon.png": (180, 180),
    "static/favicon/web-app-manifest-192x192.png": (192, 192),
    "static/favicon/web-app-manifest-512x512.png": (512, 512),
    "static/img/2post-og.jpg": (1200, 630),
}


@pytest.mark.django_db
def test_login_page_emits_brand_head_and_assets():
    client = Client()
    response = client.get("/accounts/login/")
    assert response.status_code == 200
    html = response.content.decode()
    assert 'href="/static/favicon/favicon.ico"' in html
    assert 'href="/static/favicon/favicon.svg"' in html
    assert 'href="/static/favicon/site.webmanifest"' in html
    assert 'property="og:image"' in html
    assert "/static/img/2post-og.jpg" in html
    assert 'name="twitter:card" content="summary_large_image"' in html
    assert 'src="/static/img/2post-logo.webp"' in html


def test_brand_asset_files_exist_with_expected_sizes():
    for relpath, expected_size in BRAND_ASSETS.items():
        path = ROOT / relpath
        assert path.exists(), relpath
        with Image.open(path) as image:
            assert image.size == expected_size, relpath


def test_favicon_ico_and_svg_exist():
    assert (ROOT / "static/favicon/favicon.ico").exists()
    svg = (ROOT / "static/favicon/favicon.svg").read_text(encoding="utf-8")
    assert "data:image/png;base64," in svg


def test_webmanifest_uses_black_installed_theme():
    manifest = (ROOT / "static/favicon/site.webmanifest").read_text(encoding="utf-8")
    assert '"theme_color": "#000000"' in manifest
    assert '"background_color": "#000000"' in manifest
    assert "web-app-manifest-192x192.png" in manifest
    assert "web-app-manifest-512x512.png" in manifest


def test_brand_head_partial_renders_absolute_social_image():
    request = RequestFactory().get("/")
    request.META["HTTP_HOST"] = "example.test"
    html = render_to_string("partials/_brand_head.html", {"request": request})
    assert 'property="og:image" content="http://example.test/static/img/2post-og.jpg"' in html
    assert 'name="twitter:image" content="http://example.test/static/img/2post-og.jpg"' in html


def test_email_templates_use_mark_image_not_css_tile():
    html = render_to_string(
        "notifications/email/notification.html",
        {
            "app_url": "https://app.example",
            "notification": type(
                "N",
                (),
                {"title": "Hello", "body": "Body", "data": {}},
            )(),
            "user": type("U", (), {"email": "a@example.com"})(),
        },
    )
    assert "https://app.example/static/img/2post-mark.webp" in html
    assert "background-color:#EA580C;border-radius:6px" not in html

    digest = render_to_string(
        "notifications/email/digest.html",
        {
            "app_url": "https://app.example",
            "notifications": [],
            "user": type("U", (), {"email": "a@example.com"})(),
            "date": __import__("datetime").date(2026, 7, 15),
        },
    )
    assert "https://app.example/static/img/2post-mark.webp" in digest
    assert "background-color:#EA580C;border-radius:6px" not in digest


@pytest.mark.django_db
def test_invite_expired_uses_logo_image():
    client = Client()
    response = client.get("/members/invite/not-a-real-token/accept/")
    assert response.status_code == 404
    html = response.content.decode()
    assert 'src="/static/img/2post-logo.webp"' in html
    assert 'href="/static/favicon/favicon.ico"' in html


def test_generator_check_passes():
    from brand import generate_assets

    assert generate_assets.main(["--check"]) == 0
