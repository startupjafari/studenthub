# Как устроен экран чата в Telegram для iOS — разбор исходников

Что изучалось: публичный репозиторий [TelegramMessenger/Telegram-iOS](https://github.com/TelegramMessenger/Telegram-iOS),
коммит `24638bc69bd083981b178dd1e7f921eebbf7fc46` (03.11.2026, ветка по умолчанию). Исходники читались
частичным клоном (`--filter=blob:none --sparse`), сборочные скрипты не запускались.

Лицензия: код Telegram-iOS распространяется под **GPLv2**. В этом документе нет скопированного кода —
только описание приёмов, формулы своими словами и числовые параметры (факты, не охраняемые авторским
правом). Реализация в `ios-chat-lab` пишется с нуля.

Обозначения:

- `TG/…#Lnn` — ссылка на строку в репозитории на этом коммите (все ссылки — постоянные).
- «spring-кривая TG» — кривая `.spring` из `ContainedViewLayoutTransition` (раскрыта в разделе 3);
  от длительности зависит, какой это будет физический процесс.
- Значения, которые в коде найти не удалось, помечены **«не подтверждено»**.

Базовый адрес ссылок: `https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/`

---

## 1. Раскладка и отрисовка сообщений, управление узлами

**Механизм.** Чат — это `ListViewImpl` (собственный список на AsyncDisplayKit, не `UITableView` и не
`UICollectionView`). Весь список повёрнут на 180° (`CATransform3DMakeRotation(π)`), и каждая ячейка
повёрнута обратно ещё на 180°: индекс 0 — самое новое сообщение — физически находится «сверху» списка,
а на экране оказывается внизу. Раскладка ячейки — двухфазная: `asyncLayout()` возвращает замыкание,
которое на фоновой очереди (`DispatchQueue.global(qos: .userInteractive)`) считает размеры
(`ListViewItemNodeLayout`), а на главном потоке выполняется только `apply` — присвоение фреймов и
содержимого. Пула переиспользования нет: узел создаётся на элемент и удаляется, когда выходит за
пределы видимой области плюс «невидимый запас» 500 pt сверху и снизу. Обновление существующего
элемента идёт через `updateNode` с тем же узлом (это и есть «переиспользование» — только для того же
сообщения). Все изменения списка проходят через последовательную очередь транзакций
(`ListViewTransactionQueue`), поэтому вставки, прокрутка и смена отступов не перемешиваются.
Изображения в пузырях рисуются `TransformImageNode`: сигнал строит `DrawingContext` на конкурентной
очереди, результат появляется с fade 0.15 с.

| Параметр                          | Значение                                                                   |
| --------------------------------- | -------------------------------------------------------------------------- |
| Поворот списка и ячеек            | 180° вокруг Z, оба уровня                                                  |
| Невидимый запас (preload)         | 500 pt над и под экраном (20 pt, если `preloadPages = false`)              |
| Очередь раскладки                 | `global(qos: .userInteractive)`, apply — main                              |
| Окно истории                      | 44 сообщения (`historyMessageCount`)                                       |
| Подгрузка следующей страницы      | когда видимый диапазон ближе 5 элементов к краю загруженного окна          |
| Fade картинки при первой загрузке | 0.15 с                                                                     |
| Префетч медиа                     | сообщения за видимой областью по направлению прокрутки; видео — первые 4 с |

Ссылки:

- поворот списка: [ChatHistoryListNode.swift#L1018-L1020](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/TelegramUI/Sources/ChatHistoryListNode.swift#L1018-L1020), поворот ячейки: [ChatMessageItemView.swift#L686](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/TelegramUI/Components/Chat/ChatMessageItemView/Sources/ChatMessageItemView.swift#L686)
- фоновая раскладка и `nodeForItem`: [ListView.swift#L1817-L1935](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/Display/Source/ListView.swift#L1817-L1935); запас 500 pt: [ListView.swift#L270-L275](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/Display/Source/ListView.swift#L270-L275); удаление невидимых: [ListViewIntermediateState.swift#L665-L673](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/Display/Source/ListViewIntermediateState.swift#L665-L673)
- окно истории и подгрузка: [ChatHistoryListNode.swift#L52](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/TelegramUI/Sources/ChatHistoryListNode.swift#L52), [#L3667-L3720](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/TelegramUI/Sources/ChatHistoryListNode.swift#L3667-L3720); картинки: [TransformImageNode.swift#L73-L106](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/Display/Source/TransformImageNode.swift#L73-L106)

**Что взять себе.** Перевёрнутый список (или его эквивалент «якорь у низа»), раскладка текста и размеров
вне главного потока с кэшем по ширине, удаление ячеек за пределами ±500 pt, окно истории ~40–50
сообщений с догрузкой за 5 элементов до края.

---

## 2. Инерционная прокрутка

**Механизм.** Используется обычный `UIScrollView` (`ListViewScroller`), но **скрытый**: он стоит в
иерархии с `isHidden = true`, а его `panGestureRecognizer` перевешен на view списка. Скролл-вью служит
только «физическим движком» — источником `contentOffset` с системным торможением и отскоком. В
`scrollViewDidScroll` берётся дельта смещения и сдвигаются фреймы реальных узлов; затем ставится
транзакция «догрузить/выгрузить видимые узлы». Контент «бесконечный»: `contentSize.height =
2 × 10 000`, смещение держится около середины и перецентрируется, а реальная высота подставляется,
только когда найдены оба края контента. Своей кривой торможения для обычного жеста нет —
`decelerationRate` системный (normal). Своя инерция есть только для передачи скорости из другого жеста
(`transferVelocity`): скорость затухает как `v(t) = v0 · 15 · 0.998^(1000·t)`, шаг каждый кадр
дисплей-линка, остановка при |v| < 0.1. Направление прокрутки считается с гистерезисом 14 pt.

| Параметр                          | Значение                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------ |
| Основа                            | скрытый `UIScrollView`, `alwaysBounceVertical = true`, `contentInsetAdjustmentBehavior = .never` |
| «Бесконечный» контент             | `infiniteScrollSize = 10 000` pt, `contentSize = 20 000`                                         |
| Торможение жеста                  | системное (`decelerationRate` не меняется)                                                       |
| Своя инерция (`transferVelocity`) | `v·15·0.998^(1000t)`, стоп при abs(v) < 0.1, кламп в [0, max]                                    |
| Гистерезис направления            | 14 pt накопленного смещения                                                                      |
| Overscroll-действие               | `contentOffset.y < −48` при отпускании                                                           |

Ссылки:

- скрытый скролл и перенос жеста: [ListView.swift#L546-L575](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/Display/Source/ListView.swift#L546-L575), [ListViewScroller.swift](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/Display/Source/ListViewScroller.swift)
- `transferVelocity`: [ListView.swift#L994-L1036](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/Display/Source/ListView.swift#L994-L1036); дельта и транзакции: [#L1050-L1110](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/Display/Source/ListView.swift#L1050-L1110)
- перецентрирование бесконечного контента: [ListView.swift#L1776-L1812](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/Display/Source/ListView.swift#L1776-L1812)

**Что взять себе.** Для UIKit-приложения проще оставить настоящий `UICollectionView`/`UIScrollView` —
торможение у Telegram всё равно системное. Повторять «скрытый скролл» стоит, только если нужна
бесконечная прокрутка без пересчёта `contentSize`.

---

## 3. Пружины и кривые анимаций

**Механизм.** `ContainedViewLayoutTransitionCurve` — единый набор кривых: `.linear`, `.easeInOut`,
`.easeIn`, `.spring`, `.customSpring(mass, stiffness, damping, initialVelocity)`, `.custom(4 точки
Безье)`. Ключевая деталь — **`.spring` означает разное в зависимости от длительности**:
длительность 0.5 с → `CASpringAnimation(mass 3, stiffness 1000, damping 500)` (сильно передемпфированная,
ζ ≈ 4.6 — это и есть «клавиатурная» кривая iOS); любая другая длительность → кубическая Безье
`(0.38, 0.70, 0.125, 1.0)`; на iOS 26 при длительности 0.3832 с — критически демпфированная пружина
`(mass 1, stiffness 555.027, damping 47.118)`. Все пружины **масштабируются по времени**: анимации
ставится `duration = settlingDuration`, а `speed = settlingDuration / заданная длительность`, так что
пружина любой жёсткости укладывается ровно в заданное время. Анимации высоты/смещения ячеек списка
считаются не через Core Animation, а покадрово (дисплей-линк, `ListViewAnimation`) по функции
`listViewAnimationCurveSystem(t)` — это значения той же пружины 0.5 с, взятые через `valueAt(t)`.
`animateSpring(...)` по умолчанию — пружина `mass 5, stiffness 900, damping 88` (ζ ≈ 0.66, лёгкий
отскок), тоже масштабированная по времени.

| Кривая                                       | Параметры                                                |
| -------------------------------------------- | -------------------------------------------------------- |
| `.spring`, d = 0.5 с (до iOS 26)             | `CASpringAnimation` m=3, k=1000, c=500, линейный тайминг |
| `.spring`, d = 0.5 с (iOS 26) / d = 0.3832 с | m=1, k=555.027, c=47.118 (ζ = 1.0), 80–120 fps           |
| `.spring`, любая другая d                    | `CAMediaTimingFunction(0.38, 0.70, 0.125, 1.0)`          |
| `.customSpring` по умолчанию                 | m=5, k=900, c задаётся, v0 задаётся; масштаб по времени  |
| `animateSpring` по умолчанию                 | m=5, k=900, c=88                                         |
| `.slide`                                     | Безье (0.33, 0.52, 0.25, 0.99)                           |
| `listViewAnimationCurveEaseInOut`            | Безье (0.42, 0, 0.58, 1)                                 |
| Старый фолбэк `listViewAnimationCurveSystem` | Безье (0.23, 1.0, 0.32, 1.0)                             |
| Базовая длительность анимаций списка         | 0.4 с (`insertionAnimationDuration`)                     |

Ссылки:

- перечень кривых: [ContainedViewLayoutTransition.swift#L44-L72](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/Display/Source/ContainedViewLayoutTransition.swift#L44-L72)
- выбор реализации `.spring` по длительности и масштаб пружин: [CAAnimationUtils.swift#L71-L190](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/Display/Source/CAAnimationUtils.swift#L71-L190); `animateSpring`: [#L338-L366](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/Display/Source/CAAnimationUtils.swift#L338-L366)
- параметры пружин: [UIKitUtils.m#L53-L104](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/UIKitRuntimeUtils/Source/UIKitRuntimeUtils/UIKitUtils.m#L53-L104); покадровая кривая списка: [ListViewAnimation.swift#L91-L120](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/Display/Source/ListViewAnimation.swift#L91-L120)

**Что взять себе.** Один enum кривых, где `.spring` с длительностью 0.5 = пружина m3/k1000/c500,
иначе Безье (0.38, 0.7, 0.125, 1). Для `UIView.animate` клавиатурная кривая — это
`UIView.AnimationOptions(rawValue: 7 << 16)`.

---

## 4. Контекстное меню сообщения

**Механизм.** Долгое нажатие (`ContextGesture`): через 0.12 с после касания начинается «вдавливание» —
линейный прогресс 0→1 за 0.2 с, пузырь уменьшается до `max(0.7, (w − 15)/w)` от своей ширины
(через `sublayerTransform` с компенсацией центра); по окончании прогресса меню открывается, остальные
жесты отменяются. Открытие: сообщение «вынимается» из списка в оверлей (`ContextExtractedContentContainingNode`),
фон — размытие с радиусом 10 (кастомный `UIBlurEffect`) плюс затемнение, оба появляются за 0.2 с.
Пузырь летит из исходного места в итоговое пружиной **m=5, k=900, c=104, масштабированной в 0.42 с**
(аддитивная анимация `position.y`/`position.x`). Блок действий появляется из масштаба 0.01 → 1 той
же пружиной, со сдвигом от пузыря; панель реакций — fade 0.15 с, кнопки реакций вылетают по одной с
задержкой `0.01 + 0.3 × (расстояние от центра / ширина)` и пружиной 0.4 с. Размещение: если пузырь +
меню не помещаются, вся связка сдвигается вверх так, чтобы низ был на 10 pt выше нижнего safe-отступа,
но не выше верхней границы (статус-бар + 8 pt + высота реакций + 18 pt). Меню выравнивается по
ближнему краю пузыря (левый/правый — по `midX` относительно середины экрана). Закрытие — та же
траектория в обратную сторону, но **easeInOut 0.2 с** (0.25 с, если улетает реакция); меню
сжимается в 0.01 и гаснет.

| Параметр                       | Значение                                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------------- |
| Задержка перед «вдавливанием»  | 0.12 с (`beginDelay`)                                                                              |
| Длительность вдавливания       | 0.2 с, линейно; затем открытие                                                                     |
| Масштаб вдавливания            | `max(0.7, (w − 15) / w)`                                                                           |
| Размытие фона                  | радиус 10, fade-in 0.2 с; затемнение — fade 0.2 с                                                  |
| Полёт пузыря и меню (открытие) | пружина m=5, k=900, c=104 (ζ ≈ 0.78), уложена в 0.42 с                                             |
| Появление меню                 | scale 0.01→1 (та же пружина) + alpha за 0.05 с                                                     |
| Отступы меню                   | пузырь↔меню 7 pt, низ 10 pt, верх = статус-бар + 8 pt, край экрана 12 pt                           |
| Панель реакций                 | высота 46 pt, зазор до пузыря 18 pt, кнопки: отступ 6 pt, шаг 8 pt                                 |
| Закрытие                       | easeInOut 0.2 с (0.25 с с реакцией); меню scale→0.01                                               |
| Хаптика                        | `UISelectionFeedbackGenerator` при скольжении по пунктам; хаптика при открытии **не подтверждена** |

Ссылки:

- жест и вдавливание: [ContextGesture.swift#L77](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/Display/Source/ContextGesture.swift#L77), [#L136-L177](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/Display/Source/ContextGesture.swift#L136-L177), [ContextControllerSourceNode.swift#L95-L135](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/Display/Source/ContextControllerSourceNode.swift#L95-L135)
- размытие и затемнение: [ContextControllerImpl.swift#L532-L560](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/TelegramUI/Components/ContextControllerImpl/Sources/ContextControllerImpl.swift#L532-L560), [UIKitUtils.m#L173-L195](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/UIKitRuntimeUtils/Source/UIKitRuntimeUtils/UIKitUtils.m#L173-L195)
- размещение, открытие, закрытие: [ContextControllerExtractedPresentationNode.swift#L742-L767](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/TelegramUI/Components/ContextControllerImpl/Sources/ContextControllerExtractedPresentationNode.swift#L742-L767), [#L1214-L1262](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/TelegramUI/Components/ContextControllerImpl/Sources/ContextControllerExtractedPresentationNode.swift#L1214-L1262), [#L1584-L1710](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/TelegramUI/Components/ContextControllerImpl/Sources/ContextControllerExtractedPresentationNode.swift#L1584-L1710), [#L1873-L1890](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/TelegramUI/Components/ContextControllerImpl/Sources/ContextControllerExtractedPresentationNode.swift#L1873-L1890)
- реакции: [ReactionContextNode.swift#L2520-L2577](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/ReactionSelectionNode/Sources/ReactionContextNode.swift#L2520-L2577)

---

## 5. Переход «сообщение → просмотрщик медиа» и смахивание для закрытия

**Механизм.** Открытие: снимок миниатюры из пузыря (`copyView`) летит в итоговый фрейм — позиция за
0.21 с, масштаб и границы за 0.25 с, всё spring-кривой TG (при этих длительностях это Безье
0.38/0.7/0.125/1); настоящий контент проявляется за 0.1 с, снимок гаснет за 0.2 с; фон — чёрный,
alpha 0→1 линейно за 0.15 с. Закрытие смахиванием сделано вертикальным `UIScrollView` с
`contentSize = 3 × высоты экрана`: «равновесие» в середине, отклонение = `contentOffset.y − h`.
Пока тянешь, alpha фона = `1 − |d| / 80`, интерфейса = `1 − |d| / 50`, экран чата под галереей
«возвращается» по `1 − |d| / 150`. При отпускании: если |скорость| > 1.0 (в единицах `UIScrollView`
это pt/мс, т.е. 1000 pt/с) **или** |d| > `contentSize.height / 12` = h/4 — закрыть: медиа летит обратно
в пузырь (0.25 с, spring-кривая TG; alpha копии 0.08 с), фон гаснет за 0.2 с. Иначе — возврат в
равновесие `setContentOffset(animated: true)`, а чат — пружиной m=5, k=900, c=180 за 0.45 с.

| Параметр                     | Значение                                                                 |
| ---------------------------- | ------------------------------------------------------------------------ |
| Открытие: позиция / масштаб  | 0.21 с / 0.25 с, Безье (0.38, 0.7, 0.125, 1)                             |
| Фон при открытии             | alpha 0→1, linear 0.15 с                                                 |
| Порог закрытия по расстоянию | `contentSize.height / 12 = 3h / 12 = h / 4` (≈ 211 pt при h = 844)       |
| Порог закрытия по скорости   | abs(v.y) > 1.0 pt/мс (1000 pt/с)                                         |
| Затухание фона / UI          | `1 − abs(d)/80` / `1 − abs(d)/50`                                        |
| Закрытие: полёт в пузырь     | 0.25 с, spring-кривая TG; фон гаснет 0.2 с                               |
| Закрытие без источника       | улёт контента на ±h за 0.2 с linear                                      |
| Пружина подложки-чата        | m=5, k=900, c=180, 0.45 с                                                |
| Зум                          | min 1.0, max = max(заполнение экрана, 4×); двойной тап — к max и обратно |
| Промежуток между страницами  | 20 pt (`pageGap`)                                                        |

Ссылки:

- жест закрытия: [GalleryControllerNode.swift#L417](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/GalleryUI/Sources/GalleryControllerNode.swift#L417), [#L568-L677](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/GalleryUI/Sources/GalleryControllerNode.swift#L568-L677)
- полёт из пузыря и обратно: [ChatImageGalleryItem.swift#L1019-L1083](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/GalleryUI/Sources/Items/ChatImageGalleryItem.swift#L1019-L1083), [#L1086-L1165](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/GalleryUI/Sources/Items/ChatImageGalleryItem.swift#L1086-L1165)
- зум: [ZoomableContentGalleryItemNode.swift#L82-L103](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/GalleryUI/Sources/ZoomableContentGalleryItemNode.swift#L82-L103), [#L205-L224](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/GalleryUI/Sources/ZoomableContentGalleryItemNode.swift#L205-L224)

---

## 6. Свайп для ответа

**Механизм.** Отдельный `UIPanGestureRecognizer`-наследник на каждом пузыре: одно касание; жест
проваливается, если первое движение вправо (только справа налево) или если вертикаль > 2 pt и больше
удвоенной горизонтали; подтверждается, когда горизонталь > 2 pt и больше удвоенной вертикали. На старте
готовится `UIImpactFeedbackGenerator`, отменяется долгое нажатие (контекстное меню). Пузырь двигается
через `bounds.origin.x` (а не `frame`), вместе с тенью и аватаром. До порога сдвиг 1:1, после —
резиновая формула; максимум 180 pt. Иконка ответа (кружок 33×33 pt) стоит за краем пузыря, её
прогресс `p = |сдвиг| / порог`: дуга обводки рисуется по `p`, масштаб `0.65 + 0.35 × min(1, 1.2p)`.
При `p ≥ 1` — **тяжёлый** импакт (один раз за жест) и «успех»: иконка 1.0→1.1 за 0.2 с и 1.1→1.0 за
0.15 с, обводка разлетается кольцом. При отпускании ответ срабатывает, если сырой сдвиг пальца
больше порога; пузырь возвращается за 0.3 с spring-кривой TG, иконка гаснет за 0.3 с и сжимается
до 0.2.

| Параметр            | Значение                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------ |
| Порог срабатывания  | 60 pt для исходящих, 45 pt для входящих                                                    |
| Резина после порога | `s + (1 − 1/((x − s)·0.4/100 + 1))·100`, где s — порог, x — abs(сдвиг)                     |
| Максимальный сдвиг  | 180 pt                                                                                     |
| Распознавание       | горизонталь > 2 pt и вертикаль·2 < горизонтали; провал при вертикаль > 2 и > 2·горизонтали |
| Иконка              | 33×33 pt; входящие: x = правый край + (−24), исходящие: + 10                               |
| Масштаб иконки      | `0.65 + 0.35·min(1, 1.2p)`                                                                 |
| Хаптика             | `UIImpactFeedbackGenerator(.heavy)` при p ≥ 1, однократно                                  |
| Отскок «успеха»     | 1.0→1.1 (0.2 с) → 1.0 (0.15 с)                                                             |
| Возврат             | bounds.x → 0 за 0.3 с (Безье 0.38/0.7/0.125/1); иконка alpha→0 и scale→0.2 за 0.3 с        |

Ссылки:

- распознаватель: [ChatSwipeToReplyRecognizer.swift#L34-L56](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/TelegramUI/Components/Chat/ChatSwipeToReplyRecognizer/Sources/ChatSwipeToReplyRecognizer.swift#L34-L56)
- обработчик, резина, хаптика, возврат: [ChatMessageBubbleItemNode.swift#L8095-L8228](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/TelegramUI/Components/Chat/ChatMessageBubbleItemNode/Sources/ChatMessageBubbleItemNode.swift#L8095-L8228)
- иконка: [ChatMessageSwipeToReplyNode.swift#L146-L208](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/TelegramUI/Components/Chat/ChatMessageSwipeToReplyNode/Sources/ChatMessageSwipeToReplyNode.swift#L146-L208)

---

## 7. Клавиатура и панель ввода

**Механизм.** Окно (`WindowContent`) слушает `keyboardWillChangeFrame`; длительность из уведомления
**принудительно заменяется на 0.5 с** (кроме iOS 26), кривая 7 → `.spring`, т.е. та самая пружина
m3/k1000/c500 (раздел 3). Новая высота клавиатуры попадает в layout контроллера, и **в одной
транзакции** пересчитываются панель ввода и отступ списка. Список при смене отступов не анимирует
каждый узел: фреймы ставятся сразу в конечное положение, а на слой списка вешается аддитивная
анимация `sublayerTransform` из `translate(0, −offset)` в identity с той же кривой и длительностью —
поэтому сообщения едут синхронно с клавиатурой. Переключение автокоррекции (изменение высоты ≤ 44 pt)
не анимируется. Интерактивное скрытие: жест окна начинает вести клавиатуру за пальцем после 3 pt;
при отпускании клавиатура закрывается, если её верх ушёл ниже экрана минус аксессуар **или**
скорость вниз > 100 pt/с; анимация — `.spring` 0.25 с (iOS 26 — 0.3832 с), иначе возврат `.spring` 0.25 с.
Поле ввода растёт по строкам: строка 22 pt + 2 pt, максимум `min(12, (maxH − 11 − 33)/22)` строк,
дальше внутренний скролл; изменение высоты панели анимируется **easeInOut 0.1 с**.

| Параметр                             | Значение                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------- |
| Кривая клавиатуры                    | `.spring`, 0.5 с → `CASpringAnimation` m=3, k=1000, c=500 (кривая 7 << 16) |
| iOS 26                               | системная длительность; при 0.3832 с — m=1, k=555.027, c=47.118            |
| Смена высоты ≤ 44 pt (автокоррекция) | без анимации                                                               |
| Список                               | фреймы сразу + аддитивный `sublayerTransform` с той же кривой              |
| Старт интерактивного жеста           | 3 pt                                                                       |
| Закрытие при отпускании              | верх ниже `h − accessory` или v.y > 100 pt/с                               |
| Анимация довода                      | `.spring` 0.25 с (iOS 26 — 0.3832 с)                                       |
| Рост поля ввода                      | easeInOut 0.1 с; строка 22+2 pt; ≤ 12 строк; мин. высота поля 33–35 pt     |
| Внутренние отступы поля              | top 5, left 12, bottom 4, right 11 pt                                      |

Ссылки:

- клавиатура: [WindowContent.swift#L795-L820](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/Display/Source/WindowContent.swift#L795-L820); интерактивное скрытие: [#L1590-L1656](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/Display/Source/WindowContent.swift#L1590-L1656)
- список едет вместе с клавиатурой: [ListView.swift#L3380-L3445](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/Display/Source/ListView.swift#L3380-L3445), [ChatControllerNode.swift#L2760-L2772](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/TelegramUI/Sources/ChatControllerNode.swift#L2760-L2772)
- рост поля: [ChatTextInputPanelNode.swift#L1525-L1543](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/TelegramUI/Components/Chat/ChatTextInputPanelNode/Sources/ChatTextInputPanelNode.swift#L1525-L1543), [ChatControllerNode.swift#L1001-L1012](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/TelegramUI/Sources/ChatControllerNode.swift#L1001-L1012)

---

## 8. Отправка, редактирование и удаление

**Механизм отправки.** `ChatMessageTransitionNode` переносит снимок текста/медиа из поля ввода в
место нового пузыря. Движение раздельное по осям: вертикаль и горизонталь — две аддитивные анимации
`position` с разными кривыми. Режим по умолчанию — Безье за 0.3 с: вертикаль
`(0.199, 0.011, 0.279, 0.910)`, горизонталь `(0.23, 1.0, 0.32, 1.0)`; прокрутка списка к новому
сообщению идёт **той же вертикальной кривой** (`ListViewAnimationCurve.Custom`). Отладочный режим
«пружинная отправка» (0.5 с): вертикаль — пружина k=300, c=26 (ζ ≈ 0.75, перелёт ~3%), горизонталь —
k=400, c=40 (ζ = 1) за половину времени, плюс «приседание» текста до 0.9 в первые 30% и возврат.
Пузырь-получатель на время перелёта скрыт, затем подменяется: исходник гаснет с задержкой 0.14 с
за 0.14 с, приёмник проявляется с задержкой 0.12 с за 0.1 с.

**Появление в списке.** Новая ячейка вставляется с `apparentHeight = 0` и дорастает до полной высоты за
0.4 с по покадровой пружине (раздел 3), одновременно `transitionOffset` от −1.6×высоты к 0; дочерние
узлы пузыря проявляются за 0.2 с. Остальные сообщения сдвигаются той же анимацией высоты.

**Удаление.** По умолчанию пузырь за 0.15 с гаснет, сжимается до 0.1 и смещается к центру своего фона
(easeInOut), а высота ячейки схлопывается за 0.4 с. При пользовательском удалении поверх рисуется
эффект «пыли» (`DustEffectLayer`, Metal), и длительность удаления ячейки — 0.8 с.

**Редактирование.** Обновление существующей ячейки — `updateNode` с анимацией `.System(0.4 с, spring)`:
новые размеры пузыря интерполируются, высота ячейки анимируется так же, как при вставке.
Отдельной «анимации редактирования» в исходниках не найдено (**не подтверждено**).

| Параметр                   | Значение                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------ |
| Отправка (по умолчанию)    | 0.3 с; верт. Безье (0.199, 0.011, 0.279, 0.910); гориз. Безье (0.23, 1.0, 0.32, 1.0) |
| Отправка (пружинный режим) | 0.5 с; верт. k=300/c=26/m=1; гориз. k=400/c=40 за 0.25 с; присед 0.9 на 30%          |
| Рост ячейки                | 0.4 с, пружина списка; transitionOffset −1.6h → 0                                    |
| Проявление содержимого     | alpha 0→1 за 0.2 с                                                                   |
| Удаление (обычное)         | 0.15 с: alpha→0, scale→0.1, сдвиг к центру; высота — 0.4 с                           |
| Удаление с «пылью»         | 0.8 с                                                                                |

Ссылки:

- параметры перелёта: [ChatMessageTransitionNode.swift#L329-L410](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/TelegramUI/Sources/ChatMessageTransitionNode.swift#L329-L410), [#L685-L820](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/TelegramUI/Sources/ChatMessageTransitionNode.swift#L685-L820)
- вставка/удаление в списке: [ListView.swift#L2596-L2668](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/Display/Source/ListView.swift#L2596-L2668), [ChatMessageItemView.swift#L728-L735](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/TelegramUI/Components/Chat/ChatMessageItemView/Sources/ChatMessageItemView.swift#L728-L735), [ChatMessageBubbleItemNode.swift#L1205-L1250](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/TelegramUI/Components/Chat/ChatMessageBubbleItemNode/Sources/ChatMessageBubbleItemNode.swift#L1205-L1250)
- «пыль» и 0.8 с: [ChatHistoryListNode.swift#L1023-L1032](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/TelegramUI/Sources/ChatHistoryListNode.swift#L1023-L1032), [#L4325-L4345](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/TelegramUI/Sources/ChatHistoryListNode.swift#L4325-L4345)

---

## 9. Голосовые сообщения

**Кнопка записи.** Касание кнопки микрофона запускает таймер 0.19 с — если палец ещё на кнопке,
начинается запись (короткий тап переключает режим голос/видео). Повторное касание раньше 0.4 с после
предыдущего игнорируется. Старт записи — лёгкий импакт (если не играет звуковой сигнал). Появление
оверлея: круги и панель замка из масштаба 0.2 за 0.5 с `UIView`-пружиной (damping ratio 0.55). Пока
палец держится, смещения влево (x) и вверх (y) только неположительные:

- влево: внутренний круг уменьшается `scale = max(0.4, 1 − |x|/300)`; при |x| > 150 pt — **отмена
  прямо во время движения**; при отпускании отмена, если |x| > 100 pt **или** скорость по x < −400 pt/с;
- вверх: «замкнутость» `lockness = min(1, |y|/105)` анимирует замок (дужка опускается на 6 pt, замок
  сдвигается на −16 pt, стрелка гаснет как `1 − 1.6·lockness`); при |y| > 110 pt — **фиксация**
  во время движения; при отпускании фиксация, если |y| > 60 pt **или** скорость по y < −400 pt/с;
- при отпускании учитывается только доминирующая ось.
  Круги следуют за пальцем со сглаживанием `cur = cur·0.7 + target·0.3` за кадр, уровень микрофона —
  `level = level·0.9 + input·0.1`; внешний круг масштабируется от 110/160 до 1 по уровню. Запись короче
  0.5 с отбрасывается с хаптикой ошибки (`UINotificationFeedbackGenerator.error`).

**Волна.** Пики модулей сэмплов (16 кГц, Int16) копятся в буфер; когда он достигает 200 значений,
соседние пары сливаются в 100, а коэффициент сжатия удваивается (так длина записи не важна). При
сохранении — пересэмплирование в 100 столбцов по максимуму, нормировка на
`peak = max(2500, среднее × 1.8)`, квантование в 5 бит (0…31), упаковка битовым потоком.
Отрисовка: столбик 2 pt, промежуток 1 pt, максимальная высота 12 pt, концы скруглены; число столбцов
= `floor(ширина / 3)`, сэмплы пересчитываются под это число; прогресс воспроизведения — вторым цветом
поверх.

| Параметр                                     | Значение                                                       |
| -------------------------------------------- | -------------------------------------------------------------- |
| Задержка старта записи                       | 0.19 с; антидребезг 0.4 с                                      |
| Отмена: во время движения / при отпускании   | abs(x) > 150 pt / abs(x) > 100 pt или v.x < −400 pt/с          |
| Фиксация: во время движения / при отпускании | abs(y) > 110 pt / abs(y) > 60 pt или v.y < −400 pt/с           |
| Масштаб круга при сдвиге влево               | `max(0.4, 1 − abs(x)/300)`                                     |
| Прогресс замка                               | `min(1, abs(y)/105)`                                           |
| Сглаживание                                  | позиция 0.7/0.3 за кадр, уровень 0.9/0.1                       |
| Круги                                        | внутренний Ø 110, внешний Ø 160; появление 0.5 с, damping 0.55 |
| Минимальная длительность                     | 0.5 с (иначе отброс + haptic error)                            |
| Хаптика старта                               | `UIImpactFeedbackGenerator(.light)`                            |
| Волна                                        | 100 значений × 5 бит; peak = max(2500, mean·1.8)               |
| Рендер                                       | столбик 2 pt, зазор 1 pt, высота до 12 pt                      |

Ссылки:

- жест кнопки: [TGModernConversationInputMicButton.m#L11-L13](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/LegacyComponents/Sources/TGModernConversationInputMicButton.m#L11-L13), [#L519-L560](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/LegacyComponents/Sources/TGModernConversationInputMicButton.m#L519-L560), [#L755-L980](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/LegacyComponents/Sources/TGModernConversationInputMicButton.m#L755-L980)
- таймер старта: [ChatTextInputMediaRecordingButton.swift#L517-L531](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/TelegramUI/Components/ChatTextInputMediaRecordingButton/Sources/ChatTextInputMediaRecordingButton.swift#L517-L531); хаптика: [ChatController.swift#L6686-L6690](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/TelegramUI/Sources/ChatController.swift#L6686-L6690), [ChatControllerMediaRecording.swift#L294-L296](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/TelegramUI/Sources/Chat/ChatControllerMediaRecording.swift#L294-L296)
- волна: [ManagedAudioRecorder.swift#L644-L760](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/TelegramUI/Sources/ManagedAudioRecorder.swift#L644-L760), [AudioWaveform.swift#L37-L75](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/AudioWaveform/Sources/AudioWaveform.swift#L37-L75), [AudioWaveformNode.swift#L96-L231](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/TelegramUI/Components/AudioWaveformNode/Sources/AudioWaveformNode.swift#L96-L231)

---

## 10. Сохранение позиции при обновлении истории, кнопка «вниз», закреп

**Якорение.** При любой транзакции `ListView` выбирает «фиксированный» узел: явную цель прокрутки,
иначе `stationaryItemRange` (при перезагрузке/заполнении дыры — весь диапазон), иначе **первый узел,
чей `maxY` ≥ верхнего отступа** (т.е. первый видимый), иначе последний. Новые узлы вставляются
относительно него и сдвигают соседей «от него»; поэтому догрузка старых сообщений (большие индексы,
за верхним краем) и приход новых (индекс 0) при прокрутке вверх не двигают видимое. Если же
пользователь у самого низа, видимым оказывается узел 0, и новое сообщение «выталкивает» остальные
вверх анимацией высоты (раздел 8). «У низа» в разных проверках — смещение ≤ 0.9 pt.
Анимации вставки включаются только при `InteractiveChanges`; при `Reload`/`HoleReload` — без анимаций,
со `stationaryItemRange = (0, ∞)`. Режим `keepInPlace` снимает все анимации вставки и прокручивает к
якорному сообщению с прежним смещением.

**Прокрутка к сообщению.** Если цель не загружена, история перезапрашивается с якорем на цели;
старые узлы временно остаются рядом с новыми, и весь контент анимированно сдвигается на разницу —
выглядит как короткая непрерывная прокрутка. Цель ставится по центру (`.center(.bottom)`), а при
ответе с цитатой — по центру цитаты. Подсветка: фон пузыря в «highlighted» цвете, снимается через
0.7 с (1.5 с, если найдена цитата/подцель) с fade 0.3 с; для цитаты через 0.3 с подсветка
«стягивается» к фрагменту пружиной 0.4 с.

**Кнопка «вниз».** Показывается, когда смещение от низа ≥ 40 pt (0.5 pt, если список удерживает цель
прокрутки) или неизвестно (загружен не конец истории). Кнопка 40×40 pt; появление/скрытие — alpha и
масштаб 0.2↔1 с `.spring` 0.3 с (Безье 0.38/0.7/0.125/1). Нажатие: если конец истории не загружен —
перезапрос с якорем на последнем сообщении и анимированная прокрутка.

**Закреп.** Панель 50 pt; смена закреплённого сообщения — старый текст уезжает на ±10 pt и гаснет,
новый приезжает с ∓10 pt и проявляется, 0.2 с.

| Параметр                 | Значение                                                                        |
| ------------------------ | ------------------------------------------------------------------------------- |
| Фиксированный узел       | первый с maxY ≥ верхнего отступа                                                |
| «У самого низа»          | ≤ 0.9 pt                                                                        |
| Кнопка «вниз» появляется | смещение ≥ 40 pt; 40×40 pt; scale 0.2↔1 + alpha, `.spring` 0.3 с                |
| Подсветка сообщения      | держится 0.7 с (1.5 с с цитатой), гаснет 0.3 с                                  |
| Прокрутка к сообщению    | позиция `.center(.bottom)`, кривая из транзакции (по умолчанию easeInOut 0.3 с) |
| Закреп                   | высота 50 pt; смена текста ±10 pt за 0.2 с easeInOut                            |

Ссылки:

- выбор фиксированного узла и вставка: [ListViewIntermediateState.swift#L538-L590](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/Display/Source/ListViewIntermediateState.swift#L538-L590), [#L792-L847](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/Display/Source/ListViewIntermediateState.swift#L792-L847)
- опции транзакции и удержание: [PreparedChatHistoryViewTransition.swift#L110-L133](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/TelegramUI/Sources/PreparedChatHistoryViewTransition.swift#L110-L133), [#L320-L356](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/TelegramUI/Sources/PreparedChatHistoryViewTransition.swift#L320-L356); «у низа»: [ChatHistoryListNode.swift#L2430-L2448](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/TelegramUI/Sources/ChatHistoryListNode.swift#L2430-L2448); keepInPlace: [#L4123-L4131](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/TelegramUI/Sources/ChatHistoryListNode.swift#L4123-L4131)
- анимированная прокрутка к незагруженному: [ListView.swift#L3600-L3665](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/Display/Source/ListView.swift#L3600-L3665); `scrollToEndOfHistory`: [ChatHistoryListNode.swift#L3883-L3893](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/TelegramUI/Sources/ChatHistoryListNode.swift#L3883-L3893)
- подсветка: [ChatControllerLoadDisplayNode.swift#L5372-L5402](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/TelegramUI/Sources/Chat/ChatControllerLoadDisplayNode.swift#L5372-L5402), [ChatMessageBubbleItemNode.swift#L7767-L7960](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/TelegramUI/Components/Chat/ChatMessageBubbleItemNode/Sources/ChatMessageBubbleItemNode.swift#L7767-L7960)
- кнопка «вниз»: [ChatControllerLoadDisplayNode.swift#L5300-L5343](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/TelegramUI/Sources/Chat/ChatControllerLoadDisplayNode.swift#L5300-L5343), [ChatHistoryNavigationButtons.swift#L212-L236](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/TelegramUI/Sources/ChatHistoryNavigationButtons.swift#L212-L236)
- закреп: [ChatPinnedMessageTitlePanelNode.swift#L258](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/TelegramUI/Sources/ChatPinnedMessageTitlePanelNode.swift#L258), [#L662-L682](https://github.com/TelegramMessenger/Telegram-iOS/blob/24638bc69bd083981b178dd1e7f921eebbf7fc46/submodules/TelegramUI/Sources/ChatPinnedMessageTitlePanelNode.swift#L662-L682)

---

## Что не удалось подтвердить

- Хаптика в момент открытия контекстного меню (найдена только selection-хаптика при скольжении по пунктам).
- Отдельная анимация редактирования сообщения (кроме общего `updateNode` с пружиной 0.4 с).
- Ширина блока действий контекстного меню (задаётся контентом пунктов, конкретного числа не найдено).
- Fade-in подсветки при прокрутке к сообщению (найдено только мгновенное включение и fade-out 0.3 с).
