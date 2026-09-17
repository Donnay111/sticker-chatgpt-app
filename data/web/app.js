const queryInput = document.getElementById("queryInput");
const searchBtn = document.getElementById("searchBtn");
const resultsEl = document.getElementById("results");
const statusEl = document.getElementById("status");

const pickedWrap = document.getElementById("picked");
const pickedImg = document.getElementById("pickedImg");
const pickedName = document.getElementById("pickedName");
const pickedLabels = document.getElementById("pickedLabels");

async function searchStickers(q) {
  statusEl.textContent = "正在搜索贴纸...";
  resultsEl.innerHTML = "";

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();

    if (!data.ok) {
      statusEl.textContent = "搜索失败";
      return;
    }

    const list = data.candidates || [];
    statusEl.textContent = `找到 ${list.length} 个候选`;

    if (list.length === 0) {
      resultsEl.innerHTML = "<p>没有找到结果</p>";
      return;
    }

    resultsEl.innerHTML = list
      .map(
        (item) => `
        <div class="card">
          <img src="${item.imageUrl}" alt="${item.name}">
          <div class="card-title">${item.name}</div>
          <div class="card-labels">${(item.labels || []).join(" / ")}</div>
          <button data-id="${item.id}">选这张</button>
        </div>
      `
      )
      .join("");

    document.querySelectorAll(".card button").forEach((btn) => {
      btn.addEventListener("click", () => {
        pickSticker(btn.dataset.id);
      });
    });
  } catch (err) {
    console.error(err);
    statusEl.textContent = "搜索时出错了";
  }
}

async function pickSticker(id) {
  statusEl.textContent = "正在加载贴纸...";

  try {
    const res = await fetch(`/api/pick?id=${encodeURIComponent(id)}`);
    const data = await res.json();

    if (!data.ok) {
      statusEl.textContent = "贴纸加载失败";
      return;
    }

    const s = data.sticker;
    pickedImg.src = s.imageUrl;
    pickedImg.alt = s.name;
    pickedName.textContent = s.name;
    pickedLabels.textContent = (s.labels || []).join(" / ");

    pickedWrap.classList.remove("hidden");
    statusEl.textContent = `已选中：${s.name}`;
    pickedWrap.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    console.error(err);
    statusEl.textContent = "加载贴纸时出错了";
  }
}

searchBtn.addEventListener("click", () => {
  const q = queryInput.value.trim();
  if (!q) {
    statusEl.textContent = "先输入一点关键词呀";
    return;
  }
  searchStickers(q);
});

queryInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    searchBtn.click();
  }
});

document.querySelectorAll(".tag").forEach((tag) => {
  tag.addEventListener("click", () => {
    const q = tag.dataset.q;
    queryInput.value = q;
    searchStickers(q);
  });
});
