import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("InputDock")
struct InputDockTests {
    private func sendButton(in view: InputDock) throws -> InspectableView<ViewType.Button> {
        try view.inspect().find(viewWithAccessibilityIdentifier: "chat-send-button").button()
    }

    private func cancelButton(in view: InputDock) throws -> InspectableView<ViewType.Button> {
        try view.inspect().find(viewWithAccessibilityIdentifier: "chat-cancel-button").button()
    }

    private func attachButton(in view: InputDock) throws -> InspectableView<ViewType.Button> {
        try view.inspect().find(viewWithAccessibilityIdentifier: "chat-attach-button").button()
    }

    @Test("send button disabled when text is empty")
    func sendButtonDisabledWhenTextEmpty() throws {
        @FocusState var focused: Bool
        let view = InputDock(text: .constant(""), focus: $focused, isLoading: false, contextFillPercentage: nil, contextWindowUnavailable: false, onSubmit: {}, onCancel: {})
        #expect(try sendButton(in: view).isDisabled())
    }

    @Test("send button enabled when text is present")
    func sendButtonEnabledWhenTextPresent() throws {
        @FocusState var focused: Bool
        let view = InputDock(text: .constant("Hello Toby"), focus: $focused, isLoading: false, contextFillPercentage: nil, contextWindowUnavailable: false, onSubmit: {}, onCancel: {})
        #expect(!(try sendButton(in: view).isDisabled()))
    }

    @Test("send button enabled when attachments are present")
    func sendButtonEnabledWhenAttachmentsPresent() throws {
        @FocusState var focused: Bool
        let attachment = ChatAttachmentDraft(
            filename: "notes.txt",
            mediaType: "text/plain",
            dataBase64: "aGVsbG8=",
            byteSize: 5
        )
        let view = InputDock(
            text: .constant(""),
            focus: $focused,
            isLoading: false,
            contextFillPercentage: nil,
            contextWindowUnavailable: false,
            attachments: [attachment],
            onSubmit: {},
            onCancel: {}
        )
        #expect(!(try sendButton(in: view).isDisabled()))
    }

    @Test("send button disabled while loading")
    func sendButtonDisabledWhileLoading() throws {
        @FocusState var focused: Bool
        let view = InputDock(text: .constant("Hello"), focus: $focused, isLoading: true, contextFillPercentage: nil, contextWindowUnavailable: false, onSubmit: {}, onCancel: {})
        #expect(try sendButton(in: view).isDisabled())
    }

    @Test("onSubmit called when send button tapped")
    func onSubmitCalledOnTap() throws {
        var submitted = false
        @FocusState var focused: Bool
        let view = InputDock(
            text: .constant("Hello"),
            focus: $focused,
            isLoading: false,
            contextFillPercentage: nil, contextWindowUnavailable: false,
            onSubmit: { submitted = true },
            onCancel: {}
        )
        try sendButton(in: view).tap()
        #expect(submitted)
    }

    @Test("context fill gauge is shown when percentage is provided")
    func contextFillGaugeShown() throws {
        @FocusState var focused: Bool
        let view = InputDock(
            text: .constant("Hello"),
            focus: $focused,
            isLoading: false,
            contextFillPercentage: 42, contextWindowUnavailable: false,
            onSubmit: {},
            onCancel: {}
        )
        #expect(throws: Never.self) {
            try view.inspect().find(viewWithAccessibilityIdentifier: "context-fill-gauge")
        }
    }

    @Test("context fill gauge is hidden when percentage is nil")
    func contextFillGaugeHiddenWhenNil() throws {
        @FocusState var focused: Bool
        let view = InputDock(
            text: .constant("Hello"),
            focus: $focused,
            isLoading: false,
            contextFillPercentage: nil, contextWindowUnavailable: false,
            onSubmit: {},
            onCancel: {}
        )
        #expect(throws: (any Error).self) {
            try view.inspect().find(viewWithAccessibilityIdentifier: "context-fill-gauge")
        }
    }

    @Test("context window unavailable icon is shown when provider does not support it")
    func contextWindowUnavailableIconShown() throws {
        @FocusState var focused: Bool
        let view = InputDock(
            text: .constant("Hello"),
            focus: $focused,
            isLoading: false,
            contextFillPercentage: nil, contextWindowUnavailable: true,
            onSubmit: {},
            onCancel: {}
        )
        #expect(throws: Never.self) {
            try view.inspect().find(viewWithAccessibilityIdentifier: "context-window-unavailable")
        }
    }

    @Test("cancel button is shown while loading")
    func cancelButtonShownWhileLoading() throws {
        @FocusState var focused: Bool
        let view = InputDock(
            text: .constant("Hello"),
            focus: $focused,
            isLoading: true,
            contextFillPercentage: nil, contextWindowUnavailable: false,
            onSubmit: {},
            onCancel: {}
        )
        #expect(throws: Never.self) {
            try cancelButton(in: view)
        }
    }

    @Test("cancel button is hidden when not loading")
    func cancelButtonHiddenWhenNotLoading() throws {
        @FocusState var focused: Bool
        let view = InputDock(
            text: .constant("Hello"),
            focus: $focused,
            isLoading: false,
            contextFillPercentage: nil, contextWindowUnavailable: false,
            onSubmit: {},
            onCancel: {}
        )
        #expect(throws: (any Error).self) {
            try cancelButton(in: view)
        }
    }

    @Test("attach button reflects model capability")
    func attachButtonReflectsModelCapability() throws {
        @FocusState var focused: Bool
        let enabled = InputDock(
            text: .constant("Hello"),
            focus: $focused,
            isLoading: false,
            contextFillPercentage: nil, contextWindowUnavailable: false,
            canAttachFiles: true,
            onSubmit: {},
            onCancel: {}
        )
        #expect(!(try attachButton(in: enabled).isDisabled()))

        let disabled = InputDock(
            text: .constant("Hello"),
            focus: $focused,
            isLoading: false,
            contextFillPercentage: nil, contextWindowUnavailable: false,
            canAttachFiles: false,
            onSubmit: {},
            onCancel: {}
        )
        #expect(try attachButton(in: disabled).isDisabled())
    }

    @Test("onCancel called when cancel button tapped")
    func onCancelCalledOnTap() throws {
        var cancelled = false
        @FocusState var focused: Bool
        let view = InputDock(
            text: .constant("Hello"),
            focus: $focused,
            isLoading: true,
            contextFillPercentage: nil, contextWindowUnavailable: false,
            onSubmit: {},
            onCancel: { cancelled = true }
        )
        try cancelButton(in: view).tap()
        #expect(cancelled)
    }
}
