import unittest

from stealth_reader.reader import detect_verification, parse_article, validate_url


class UrlValidationTests(unittest.TestCase):
    def test_accepts_https_url(self):
        self.assertEqual(validate_url("https://mp.weixin.qq.com/s/abc?x=1"), (True, None))
        self.assertEqual(validate_url("https://www.example.com/article"), (True, None))

    def test_accepts_http_url(self):
        self.assertEqual(validate_url("http://example.com"), (True, None))

    def test_rejects_credentials_and_bad_ports(self):
        for url in (
            "https://user@mp.weixin.qq.com/s/abc",
            "https://mp.weixin.qq.com:444/s/abc",
        ):
            with self.subTest(url=url):
                self.assertFalse(validate_url(url)[0])


class ParsingTests(unittest.TestCase):
    def test_extracts_article(self):
        html = """
        <html><head><meta property="og:title" content="Fallback title"></head><body>
          <h1 id="activity-name"> Test title </h1>
          <em id="publish_time">2026-07-10</em>
          <div id="js_content"><h2>Heading</h2><p>Hello <b>world</b>.</p></div>
        </body></html>
        """
        article = parse_article(html)
        self.assertEqual(article["title"], "Test title")
        self.assertEqual(article["published_at"], "2026-07-10")
        self.assertIn("## Heading", article["content_markdown"] or "")
        self.assertIn("**world**", article["content_markdown"] or "")

    def test_short_content_is_still_returned(self):
        article = parse_article("<html><h1>Not an article</h1></html>")
        self.assertEqual(article["title"], "Not an article")
        self.assertIn("Not an article", article["content_markdown"] or "")

    def test_detects_verification_without_bypass(self):
        markers = detect_verification("<html><body>当前环境异常，请完成验证</body></html>")
        self.assertIn("当前环境异常", markers)
        self.assertIn("完成验证", markers)


if __name__ == "__main__":
    unittest.main()
