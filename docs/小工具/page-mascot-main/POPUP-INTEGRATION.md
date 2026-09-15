# page-mascot 交互扩展：点击后弹出表单弹窗

## 目标

在保留现有动态效果（光标跟踪、点击 squash、表情切换）的前提下，为 `Mascot` 增加点击后的联动能力，实现点击吉祥物后弹出表单填写弹窗。

## 现状约束

- 现有交互完全在 `mascot.tsx` 内闭环。
- `boop()` 负责调度表情和 squash 动画。
- 组件本身不自带弹窗，避免引入 UI 框架依赖，保持“无 CSS 框架即可直接使用”。
- 现有 props：`directions`、`reactions`、`size`、`label`、`className`。

## 推荐方案

新增一个可选 prop：`onInteract`，在点击后立即或延迟触发。

### 1. 扩展接口

```ts
export type MascotProps = {
  directions: string
  reactions: string
  size?: number
  className?: string
  label?: string
  onInteract?: (event: React.MouseEvent<HTMLButtonElement>) => void
}
```

### 2. 接入点

在 `mascot.tsx` 的 `boop()` 里追加：

```ts
const boop = (event: React.MouseEvent<HTMLButtonElement>) => {
  // 保留原有动画与表情调度
  ...

  // 新增：外部可感知的交互回调
  props.onInteract?.(event)
}
```

并将按钮的 `onClick` 改为：

```ts
<button
  ref={buttonRef}
  type="button"
  onClick={boop}
  ...
>
```

### 3. 调用时机建议

| 时机 | 写法 | 适用场景 |
| --- | --- | --- |
| 立即 | `onInteract?.(event)` | 打开轻量确认 |
| 延迟 | `setTimeout(() => onInteract?.(event), 560)` | 等待 squash 结束再弹表单 |
| 连点后 | 在 `boops.count >= DIZZY_AFTER` 分支内触发 | 用户熟悉后的快捷入口 |

### 4. 外部使用示例

#### 表单弹窗

```tsx
function Page() {
  const [form, setForm] = useState(false)

  return (
    <>
      <Mascot
        directions="/mascots/fox-directions.webp"
        reactions="/mascots/fox-reactions.webp"
        onInteract={() => setTimeout(() => setForm(true), 560)}
      />

      {form && (
        <dialog open={form} onClose={() => setForm(false)}>
          <form method="dialog">
            <h2>Contact</h2>
            <input name="email" placeholder="you@example.com" />
            <menu>
              <button value="cancel">Cancel</button>
              <button value="confirm">Send</button>
            </menu>
          </form>
        </dialog>
      )}
    </>
  )
}
```

### 5. 实现步骤

1. 在 `src/mascot.tsx` 修改 `MascotProps` 和 `boop` 签名。
2. 在 `src/index.ts` 确认导出不变。
3. 在 `site/app.tsx` 内新增一个 demo 页签或示例，验证 `onInteract`。
4. 运行 `npm run typecheck` 和 `npm run lint`。
5. 更新 `README.md` 的 Props 表格，补充 `onInteract`。

## 实现后守则

- 保持 props 向后兼容，`onInteract` 可选。
- 不替换现有按钮或动画层。
- 弹窗由消费方控制，`page-mascot` 不依赖任何 dialog 库。
- 尊重 `prefers-reduced-motion`：不修改现有检测逻辑。
