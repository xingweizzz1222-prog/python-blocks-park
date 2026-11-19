# Python 积木乐园 | Python Blocks Park

**一个受 Scratch 启发，以 Python 为底层语言的 Web 积木编程创作工具。**

A Scratch-inspired, web-based visual programming playground powered by Python.

**在线体验 / Live Demo：**

https://python-blocks-park-uv226rv2z0c.qoder.zone/

---

# 简体中文

## 项目介绍

Python 积木乐园是一个基于 Web 的积木式编程创作工具。

项目以 Scratch 的积木式交互为参考，希望让用户不必一开始就面对复杂的代码，而是通过拖拽、组合积木构建程序，在可视化舞台中观察运行结果，并查看对应的 Python 代码。

它不仅是一个编程启蒙工具，也希望成为一个自由创作的平台，让更多人体验逻辑思考和编程创造的乐趣。

## 主要功能

- **积木式编程：** 通过拖拽和组合积木构建程序。
- **Python 代码展示：** 查看积木组合生成的 Python 代码。
- **可视化舞台：** 通过角色和舞台观察程序运行结果。
- **角色交互：** 支持角色运动、碰撞检测、消息广播等交互。
- **自定义素材：** 支持图片导入、裁剪和素材管理。
- **项目存档：** 支持浏览器本地自动保存、存档导入与导出。
- **全屏展示：** 提供独立的全屏展示页面。

## 技术栈

| 技术 | 用途 |
|---|---|
| Vite | 前端开发与构建 |
| JavaScript / TypeScript | 页面交互与业务逻辑 |
| Blockly | 积木式编程编辑 |
| Pyodide | 浏览器中的 Python 运行环境 |
| LocalStorage | 项目数据自动保存 |
| IndexedDB | 图片素材及元数据存储 |

## 本地运行

**环境要求：** 已安装 Node.js 和 npm。

安装依赖：

```bash
npm install
```

启动开发环境：

```bash
npm run dev
```

生产构建：

```bash
npm run build
```

本地预览：

```bash
npm run preview
```

项目会在开发和构建前自动准备 Pyodide 核心运行资源，无需手动从外部 CDN 下载。

## 项目结构

```text
python-blocks-park/
├── docs/             # 开发日志与验收记录
├── public/           # 静态资源
├── scripts/          # 项目辅助脚本
├── src/
│   ├── assets/       # 图片素材管理
│   ├── blocks/       # 积木系统
│   ├── codeview/     # Python 代码展示
│   ├── fullscreen/   # 全屏展示
│   ├── intro/        # 开场动画
│   ├── layout/       # 页面布局
│   ├── runtime/      # 程序运行环境
│   ├── sensing/      # 侦测与碰撞
│   ├── spriteSettings/ # 角色设置
│   ├── stage/        # 舞台系统
│   ├── storage/      # 项目存档
│   └── styles/       # 样式
├── scripts/
├── fullscreen.html
├── index.html
├── package.json
└── vite.config.ts
```

## 开发记录

项目采用模块化开发，并通过开发变更日志记录功能实现、涉及文件、验证过程和遗留问题。

详细记录：

- [开发变更日志](docs/开发日志.md)
- [碰撞与广播链路验收](docs/清理验收-碰撞广播链路.png)
- [默认初始状态验收](docs/清理验收-默认初始状态.png)
- [公网碰撞与广播验收](docs/部署验收-公网碰撞广播.png)
- [公网编辑器验收](docs/部署验收-公网编辑器.png)

## 项目初衷

编程不应该只是学习语法，也可以是探索世界、表达想法和自由创造的一种方式。

希望这个小小的项目能够成为某个人好奇心的起点。

---

# English

## About

Python Blocks Park is a web-based visual programming playground inspired by Scratch.

Instead of starting with complex code, users can build programs by dragging and connecting blocks, observe their results on a visual stage, and explore the corresponding Python code.

The project aims to make programming more approachable while providing a space for logical thinking, experimentation, and creative exploration.

It is designed for anyone interested in programming and creativity, regardless of age or experience.

## Features

- **Visual Block Programming:** Build programs by dragging and connecting blocks.
- **Python Code View:** View the Python code generated from block programs.
- **Visual Stage:** Observe program execution through sprites and stage interactions.
- **Sprite Interactions:** Supports movement, collision detection, and message broadcasting.
- **Custom Assets:** Import, crop, and manage custom images.
- **Project Storage:** Automatic local saving, project import, and export.
- **Fullscreen Mode:** A dedicated fullscreen presentation page.

## Tech Stack

| Technology | Purpose |
|---|---|
| Vite | Frontend development and build tool |
| JavaScript / TypeScript | UI interactions and application logic |
| Blockly | Visual block programming editor |
| Pyodide | Python runtime in the browser |
| LocalStorage | Automatic project data persistence |
| IndexedDB | Image assets and metadata storage |

## Getting Started

**Prerequisites:** Node.js and npm.

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

The project automatically prepares the required Pyodide runtime files before development and production builds.

## Development Notes

The project uses a modular architecture and maintains a development changelog documenting implementation details, modified files, testing procedures, and outstanding issues.

See the [Development Changelog](docs/开发日志.md) and the verification screenshots in the `docs/` directory.

## Philosophy

Programming is more than learning syntax. It is a way to explore ideas, understand logic, and create something of your own.

We hope this project can be the starting point of someone's curiosity.

---

**Have fun creating!**

## License

This project is licensed under the MIT License.
See [LICENSE](LICENSE) for details.

Copyright (c) 2026 xingwei