package kz.studenthub.app.shell

import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner

/**
 * Модели экранов — по одной области на шаг навигации.
 *
 * Без этого модели жили бы в активности до её смерти: каждый открытый чат держал бы
 * подписки на базу, пока приложение не закроют. Здесь область очищается, как только
 * шаг ушёл из стека, — то же, что делает navigation-compose, но для своего роутера.
 */
class RouteStores {
    private val stores = mutableMapOf<String, ViewModelStore>()

    fun owner(key: String): ViewModelStoreOwner {
        val store = stores.getOrPut(key) { ViewModelStore() }
        return object : ViewModelStoreOwner {
            override val viewModelStore: ViewModelStore = store
        }
    }

    /** Отпустить всё, чего больше нет в стеках: модели закрываются, подписки рвутся. */
    fun retainOnly(live: Set<String>) {
        val gone = stores.keys - live
        gone.forEach { stores.remove(it)?.clear() }
    }

    fun clear() {
        stores.values.forEach { it.clear() }
        stores.clear()
    }
}
