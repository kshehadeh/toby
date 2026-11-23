import Foundation
import Testing
@testable import TobyMail

@Suite("MIME content")
struct MIMEContentTests {
	private func content(_ message: String) -> MIME.Content {
		MIME.content(of: Data(message.replacingOccurrences(of: "\n", with: "\r\n").utf8))
	}

	@Test func inlinesCIDImagesAndListsAttachments() {
		let result = content("""
		Content-Type: multipart/mixed; boundary="m"

		--m
		Content-Type: multipart/related; boundary="r"

		--r
		Content-Type: multipart/alternative; boundary="a"

		--a
		Content-Type: text/plain

		Plain
		--a
		Content-Type: text/html

		<p>Rich <img src="cid:image1@x"><img src="cid:image10@x"></p>
		--a--
		--r
		Content-Type: image/png; name="one.png"
		Content-ID: <image1@x>
		Content-Disposition: inline; filename="one.png"
		Content-Transfer-Encoding: base64

		QUE=
		--r
		Content-Type: image/png
		Content-ID: <image10@x>
		Content-Transfer-Encoding: base64

		QkI=
		--r--
		--m
		Content-Type: application/pdf; name="q.pdf"
		Content-Disposition: attachment; filename="Quote Q3.pdf"
		Content-Transfer-Encoding: base64

		UERG
		--m
		Content-Type: text/calendar; method=REQUEST

		BEGIN:VCALENDAR
		--m--

		""")
		#expect(result.text == "Plain")
		#expect(result.html == "<p>Rich <img src=\"data:image/png;base64,QUE=\"><img src=\"data:image/png;base64,QkI=\"></p>")
		#expect(result.attachments.map(\.filename) == ["Quote Q3.pdf", "invite.ics"])
		#expect(result.attachments.first?.data == Data("PDF".utf8))
	}

	@Test func joinsSequentialBodiesAndKeepsUnusedInlineImages() {
		let result = content("""
		Content-Type: multipart/mixed; boundary=m

		--m
		Content-Type: text/html

		<b>Top</b>
		--m
		Content-Type: image/jpeg
		Content-ID: <unused>
		Content-Disposition: inline; filename=photo.jpg

		x
		--m
		Content-Type: text/plain

		1 < 2
		--m--

		""")
		#expect(result.html == "<b>Top</b>\n<div style=\"white-space:pre-wrap\">1 &lt; 2</div>")
		#expect(result.text == "Top\n\n1 < 2")
		#expect(result.attachments.map(\.filename) == ["photo.jpg"])
	}

	@Test func plainMessagesHaveNoHTML() {
		let result = content("Content-Type: text/plain; charset=utf-8\n\nHi there")
		#expect(result == MIME.Content(text: "Hi there", html: "", attachments: []))
	}

	@Test func decodesFilenames() {
		#expect(MIME.filename("attachment; filename*=utf-8''R%C3%A9sum%C3%A9%20%3D1.pdf", parameter: "filename") == "Résumé =1.pdf")
		#expect(MIME.filename("attachment; filename*0*=iso-8859-1''caf%E9-; filename*1=\"menu.txt\"", parameter: "filename") == "café-menu.txt")
		#expect(MIME.filename("attachment; filename=\"=?UTF-8?Q?Gr=C3=BC=C3=9Fe.txt?=\"", parameter: "filename") == "Grüße.txt")
		#expect(MIME.filename("inline", parameter: "filename") == nil)
	}

	@Test func filenamesStayInTheirFolder() {
		#expect(MIME.safeFilename("../../.ssh/authorized_keys") == "authorized_keys")
		#expect(MIME.safeFilename("C:\\temp\\a.exe") == "a.exe")
		#expect(MIME.safeFilename("..") == "Attachment")
		#expect(MIME.safeFilename(".zshrc") == "zshrc")
	}
}
