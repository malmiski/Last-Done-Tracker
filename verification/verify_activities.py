import sys
from playwright.sync_api import sync_playwright

def run_cuj(page):
    print("Navigating to homepage...")
    page.goto("http://localhost:8081")
    page.wait_for_timeout(2000)

    # Click on "Add Activity"
    print("Clicking Add Activity...")
    add_btn = page.get_by_text("Add Activity")
    add_btn.click()
    page.wait_for_timeout(1000)

    # Fill activity name
    print("Filling activity name...")
    page.get_by_placeholder("E.g., Read a book").fill("Test Running")
    page.wait_for_timeout(500)

    # Save activity
    print("Saving activity...")
    page.get_by_text("Save Activity").click()
    page.wait_for_timeout(1500)

    # Now we should be back at homepage. Click on "Test Running" to view details.
    print("Clicking on 'Test Running'...")
    page.get_by_text("Test Running").first.click()
    page.wait_for_timeout(1500)

    # Take screenshot of the detail screen
    print("Taking screenshot...")
    page.screenshot(path="/app/verification/screenshots/verification.png")
    page.wait_for_timeout(1000)

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            record_video_dir="/app/verification/videos"
        )
        page = context.new_page()
        try:
            run_cuj(page)
        except Exception as e:
            print(f"Error during CUJ: {e}")
            sys.exit(1)
        finally:
            context.close()
            browser.close()
    print("Verification completed successfully!")
