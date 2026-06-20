import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("InputDock")
struct InputDockTests {
    // InputDock body: VStack > [TextField, HStack > [Text, Text, Spacer, Button]]
    private func sendButton(in view: InputDock) throws -> InspectableView<ViewType.Button> {
        try view.inspect().vStack().hStack(1).button(3)
    }

    @Test("send button disabled when text is empty")
    func sendButtonDisabledWhenTextEmpty() throws {
        @FocusState var focused: Bool
        let view = InputDock(text: .constant(""), focus: $focused, isLoading: false, onSubmit: {})
        #expect(try sendButton(in: view).isDisabled())
    }

    @Test("send button enabled when text is present")
    func sendButtonEnabledWhenTextPresent() throws {
        @FocusState var focused: Bool
        let view = InputDock(text: .constant("Hello Toby"), focus: $focused, isLoading: false, onSubmit: {})
        #expect(!(try sendButton(in: view).isDisabled()))
    }

    @Test("send button disabled while loading")
    func sendButtonDisabledWhileLoading() throws {
        @FocusState var focused: Bool
        let view = InputDock(text: .constant("Hello"), focus: $focused, isLoading: true, onSubmit: {})
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
            onSubmit: { submitted = true }
        )
        try sendButton(in: view).tap()
        #expect(submitted)
    }
}
