const chat =
  document.getElementById(
    "chat"
  );

const input =
  document.getElementById(
    "messageInput"
  );

const sendButton =
  document.getElementById(
    "sendButton"
  );

const clearButton =
  document.getElementById(
    "clearButton"
  );

const typing =
  document.getElementById(
    "typing"
  );


let messages = [];

let sending = false;


// ============================================================
// 保存聊天记录
// ============================================================

function saveMessages() {

  try {

    localStorage.setItem(
      "stickerChatMessages",
      JSON.stringify(messages)
    );

  } catch {}
}


function loadMessages() {

  try {

    const saved =
      localStorage.getItem(
        "stickerChatMessages"
      );


    if (!saved) {
      return;
    }


    const parsed =
      JSON.parse(saved);


    if (
      Array.isArray(parsed)
    ) {

      messages =
        parsed.slice(-40);
    }

  } catch {

    messages = [];
  }
}


// ============================================================
// 安全处理文字
// ============================================================

function textNode(text) {

  const span =
    document.createElement(
      "span"
    );

  span.textContent =
    String(text || "");

  return span;
}


// ============================================================
// 加一条消息到画面
// ============================================================

function renderMessage({
  role,
  content,
  sticker,
  error = false
}) {

  const wrapper =
    document.createElement(
      "div"
    );


  wrapper.className =
    `message ${role}`;


  const inner =
    document.createElement(
      "div"
    );


  const bubble =
    document.createElement(
      "div"
    );


  bubble.className =
    "bubble";


  if (error) {

    bubble.classList.add(
      "error-bubble"
    );
  }


  bubble.appendChild(
    textNode(content)
  );


  inner.appendChild(
    bubble
  );


  if (
    sticker &&
    sticker.imageUrl
  ) {

    const stickerWrap =
      document.createElement(
        "div"
      );


    stickerWrap.className =
      "sticker-wrap";


    const image =
      document.createElement(
        "img"
      );


    image.className =
      "sticker";

    image.src =
      sticker.imageUrl;

    image.alt =
      sticker.name || "sticker";

    image.loading =
      "lazy";


    stickerWrap.appendChild(
      image
    );


    inner.appendChild(
      stickerWrap
    );


    if (
      sticker.name
    ) {

      const name =
        document.createElement(
          "div"
        );


      name.className =
        "sticker-name";

      name.textContent =
        sticker.name;


      inner.appendChild(
        name
      );
    }
  }


  wrapper.appendChild(
    inner
  );


  chat.appendChild(
    wrapper
  );


  scrollBottom();
}


// ============================================================
// 滚动到底
// ============================================================

function scrollBottom() {

  requestAnimationFrame(
    () => {

      chat.scrollTop =
        chat.scrollHeight;
    }
  );
}


// ============================================================
// 重画历史记录
// ============================================================

function renderHistory() {

  chat.innerHTML = "";


  if (
    messages.length === 0
  ) {

    renderMessage({

      role:
        "assistant",

      content:
        "宝宝我在 😼 现在这个才是聊天版。"
    });

    return;
  }


  for (
    const message
    of messages
  ) {

    renderMessage(
      message
    );
  }
}


// ============================================================
// 输入框高度
// ============================================================

function resizeInput() {

  input.style.height =
    "auto";


  input.style.height =
    `${Math.min(
      input.scrollHeight,
      160
    )}px`;
}


// ============================================================
// 发送
// ============================================================

async function sendMessage() {

  const text =
    input.value.trim();


  if (
    !text ||
    sending
  ) {

    return;
  }


  sending = true;

  sendButton.disabled =
    true;

  typing.classList.remove(
    "hidden"
  );


  input.value = "";

  resizeInput();


  const userMessage = {

    role:
      "user",

    content:
      text
  };


  messages.push(
    userMessage
  );


  renderMessage(
    userMessage
  );


  saveMessages();


  try {

    const apiMessages =
      messages
        .slice(-20)
        .map(
          (message) => ({

            role:
              message.role,

            content:
              message.content
          })
        );


    const response =
      await fetch(
        "/api/chat",
        {

          method:
            "POST",

          headers: {

            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({

              messages:
                apiMessages
            })
        }
      );


    const data =
      await response.json();


    if (
      !response.ok ||
      !data.ok
    ) {

      throw new Error(
        data?.error ||
        "聊天请求失败"
      );
    }


    const assistantMessage = {

      role:
        "assistant",

      content:
        data.reply ||
        "🥲",

      sticker:
        data.sticker || null
    };


    messages.push(
      assistantMessage
    );


    renderMessage(
      assistantMessage
    );


    saveMessages();

  } catch (error) {

    console.error(error);


    renderMessage({

      role:
        "assistant",

      content:
        `出错了：${error.message}`,

      error:
        true
    });

  } finally {

    sending = false;

    sendButton.disabled =
      false;

    typing.classList.add(
      "hidden"
    );


    input.focus();
  }
}


// ============================================================
// 事件
// ============================================================

sendButton.addEventListener(
  "click",
  sendMessage
);


input.addEventListener(
  "input",
  resizeInput
);


input.addEventListener(
  "keydown",
  (event) => {

    if (
      event.key === "Enter" &&
      !event.shiftKey
    ) {

      event.preventDefault();

      sendMessage();
    }
  }
);


clearButton.addEventListener(
  "click",
  () => {

    const confirmed =
      window.confirm(
        "清空这段聊天吗？"
      );


    if (!confirmed) {
      return;
    }


    messages = [];


    try {

      localStorage.removeItem(
        "stickerChatMessages"
      );

    } catch {}


    renderHistory();


    input.focus();
  }
);


// ============================================================
// 初始化
// ============================================================

loadMessages();

renderHistory();

resizeInput();

input.focus();
