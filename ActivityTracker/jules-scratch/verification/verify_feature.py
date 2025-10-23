from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto("http://localhost:8000")
    page.wait_for_load_state("networkidle")

    # Click the first activity in the list
    page.get_by_text("Go to details").first.click()

    # Wait for the detail page to load and find the link to the graph view
    page.wait_for_url("**/ActivityDetail**")
    graph_link = page.get_by_role("link", name="chart-line")
    expect(graph_link).to_be_visible()
    graph_link.click()

    # Wait for the graph page to load and verify the title
    page.wait_for_url("**/GraphView**")
    expect(page.locator('text*="Graph"')).to_be_visible()

    # Take a screenshot for verification
    page.screenshot(path="ActivityTracker/jules-scratch/verification/verification.png")
    browser.close()