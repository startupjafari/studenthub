import SwiftUI

/// Запись круглого видео поверх фото: фронтальная камера в круге, фото под ним.
/// После записи кружок становится объектом холста — его двигают и масштабируют, а сама
/// история не публикуется.
struct StoryRoundVideoOverlay: View {
    let model: StoryStudioModel
    let canvas: CGRect

    var body: some View {
        let diameter = canvas.width * 0.62
        ZStack(alignment: .topLeading) {
            Color.black.opacity(0.4)
                .frame(width: canvas.width, height: canvas.height)
                .clipShape(RoundedRectangle(cornerRadius: StoryStageLayout.cornerRadius, style: .continuous))
                .offset(x: canvas.minX, y: canvas.minY)

            ZStack {
                StoryCameraPreview(camera: model.camera)
                    .frame(width: diameter, height: diameter)
                    .clipShape(Circle())
                if let started = model.roundRecordingStartedAt {
                    TimelineView(.animation) { context in
                        let progress = min(context.date.timeIntervalSince(started) / StoryRoundVideoPayload.maxDuration, 1)
                        Circle()
                            .trim(from: 0, to: progress)
                            .stroke(Color.red, style: StrokeStyle(lineWidth: 5, lineCap: .round))
                            .rotationEffect(.degrees(-90))
                    }
                    .frame(width: diameter + 12, height: diameter + 12)
                }
                if model.isPreparingRoundCamera {
                    ProgressView().tint(.white)
                }
            }
            .frame(width: canvas.width, height: diameter + 12)
            .offset(x: canvas.minX, y: canvas.minY + canvas.height * 0.4 - diameter / 2)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(String(localized: "stories.editor.roundVideo", defaultValue: "Круглое видео")))
            .accessibilityIdentifier("story.round.preview")

            if let started = model.roundRecordingStartedAt {
                RecordingTimer(start: started, limit: StoryRoundVideoPayload.maxDuration)
                    .frame(width: canvas.width)
                    .offset(x: canvas.minX, y: canvas.minY + Spacing.xl)
            }

            HStack {
                Button(String(localized: "stories.cancel", defaultValue: "Отмена")) { model.cancelRoundVideo() }
                    .foregroundStyle(.white)
                    .accessibilityIdentifier("story.tool.cancel")
                Spacer()
                Button {
                    Task { await model.roundShutterTapped() }
                } label: {
                    ZStack {
                        Circle().stroke(.white, lineWidth: 4).frame(width: 70, height: 70)
                        RoundedRectangle(cornerRadius: model.roundRecordingStartedAt == nil ? 28 : 7, style: .continuous)
                            .fill(Color.red)
                            .frame(width: model.roundRecordingStartedAt == nil ? 56 : 26, height: model.roundRecordingStartedAt == nil ? 56 : 26)
                    }
                    .animation(Motion.snappy, value: model.roundRecordingStartedAt == nil)
                }
                .buttonStyle(.pressable)
                .disabled(model.isPreparingRoundCamera)
                .accessibilityLabel(Text(model.roundRecordingStartedAt == nil
                    ? String(localized: "stories.camera.record", defaultValue: "Начать запись")
                    : String(localized: "stories.camera.stop", defaultValue: "Остановить запись")))
                .accessibilityIdentifier("story.round.shutter")
                .accessibilityValue(Text(verbatim: model.roundRecordingStartedAt == nil ? "idle" : "recording"))
                Spacer()
                Color.clear.frame(width: 60, height: 1)
            }
            .padding(.horizontal, Spacing.xl)
            .frame(width: canvas.width)
            .offset(x: canvas.minX, y: canvas.maxY - 90)
        }
        .transition(.opacity)
    }
}
