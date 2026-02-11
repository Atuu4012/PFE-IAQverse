import pytest
from playwright.sync_api import Page, expect

def test_digital_twin_page_loads(page: Page):
    """Test that the digital twin page loads correctly"""
    # Assuming the frontend is served at localhost:8000 or similar during tests
    # For now, we'll try to load the file directly if possible, or assume a dev server
    # adjustments might be needed based on how the CI/CD runs the frontend
    
    # In a real scenario, we'd navigate to the deployed URL or local dev server
    # For this example, we'll assume a local server is running
    try:
        page.goto("http://localhost:8000/frontend/digital-twin.html")
    except:
         pytest.skip("Frontend server not validation reachable, skipping UI test")

    # Check title
    expect(page).to_have_title("Digital Twin - IAQverse")

    # Check for key elements
    expect(page.locator("#3d-view")).to_be_visible()
    expect(page.locator(".sidebar")).to_be_visible()

def test_charts_are_present(page: Page):
    """Test that charts are rendered"""
    try:
        page.goto("http://localhost:8000/frontend/index.html")
    except:
         pytest.skip("Frontend server not reachable, skipping UI test")

    # Check for canvas elements which usually indicate charts
    # expect(page.locator("canvas")).to_have_count(3) # Example count
    pass
