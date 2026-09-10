let messages=[];let attachedFiles=[];
const promptBox=document.getElementById("prompt");
const menu=document.getElementById("attachmentMenu");
const fileInput=document.getElementById("fileInput");
const chat=document.getElementById("chat");
const welcome=document.getElementById("welcome");
const attachedContainer=document.getElementById("attachedFiles");
const sendButton=document.querySelector(".send-button");
const RECENT_STORAGE_KEY="codeforge_recent";

function toggleAttachmentMenu(){if(!menu)return;menu.classList.toggle("open");}
function openFilePicker(){if(!fileInput)return;fileInput.click();}
function handleFiles(files){
    if(!files||files.length===0)return;
    attachedFiles=[];
    let loadedFiles=0;
    for(const file of files){
        const reader=new FileReader();
        reader.onload=function(event){
            attachedFiles.push({name:file.name,content:event.target.result});
            loadedFiles++;
            renderAttachedFiles();
        };
        reader.onerror=function(){console.error("Unable to read file:",file.name);};
        reader.readAsText(file);
    }
    if(menu)menu.classList.remove("open");
}
function renderAttachedFiles(){
    if(!attachedContainer)return;
    attachedContainer.innerHTML="";
    attachedFiles.forEach(function(file,index){
        const chip=document.createElement("div");
        chip.className="file-chip";
        const name=document.createElement("span");
        name.textContent="📎 "+file.name;
        const removeButton=document.createElement("button");
        removeButton.type="button";
        removeButton.textContent="×";
        removeButton.title="Remove file";
        removeButton.onclick=function(){
            attachedFiles.splice(index,1);
            renderAttachedFiles();
        };
        chip.appendChild(name);
        chip.appendChild(removeButton);
        attachedContainer.appendChild(chip);
    });
}
function autoResize(element){
    if(!element)return;
    element.style.height="auto";
    const maxHeight=220;
    element.style.height=Math.min(element.scrollHeight,maxHeight)+"px";
}
function handleKey(event){
    if(event.key==="Enter"&&!event.shiftKey){
        event.preventDefault();
        sendMessage();
    }
}
function escapeHtml(text){
    const div=document.createElement("div");
    div.textContent=text||"";
    return div.innerHTML;
}
function formatAI(text){
    if(!text)return "";
    let result=escapeHtml(text);
    const codeBlocks=[];
    result=result.replace(/```([a-zA-Z0-9_+#.-]*)\n([\s\S]*?)```/g,function(match,language,code){
        const index=codeBlocks.length;
        codeBlocks.push({language:language||"",code:code});
        return `___CODE_BLOCK_${index}___`;
    });
    result=result.replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>");
    result=result.replace(/`([^`]+)`/g,"<code>$1</code>");
    result=result.replace(/^### (.*?)$/gm,"<strong>$1</strong>");
    result=result.replace(/^## (.*?)$/gm,"<strong>$1</strong>");
    result=result.replace(/^# (.*?)$/gm,"<strong>$1</strong>");
    result=result.replace(/\n/g,"<br>");
    codeBlocks.forEach(function(block,index){
        const language=block.language?`<div class="code-language">${escapeHtml(block.language)}</div>`:"";
        const codeHtml=`<div class="code-wrapper">${language}<pre><code>${block.code}</code></pre></div>`;
        result=result.replace(`___CODE_BLOCK_${index}___`,codeHtml);
    });
    return result;
}
function addMessage(role,content){
    if(!chat)return;
    const wrapper=document.createElement("div");
    wrapper.className="message "+role;
    const inner=document.createElement("div");
    inner.className="message-content";
    if(role==="assistant"){
        inner.innerHTML=formatAI(content);
    }else{
        inner.innerHTML=escapeHtml(content).replace(/\n/g,"<br>");
    }
    wrapper.appendChild(inner);
    chat.appendChild(wrapper);
    setTimeout(function(){
        chat.scrollTo({top:chat.scrollHeight,behavior:"smooth"});
    },50);
}
function showLoading(){
    if(!chat)return null;
    const wrapper=document.createElement("div");
    wrapper.className="message assistant loading-message";
    const inner=document.createElement("div");
    inner.className="message-content";
    inner.innerHTML=`<span class="typing"><span></span><span></span><span></span></span>`;
    wrapper.appendChild(inner);
    chat.appendChild(wrapper);
    chat.scrollTo({top:chat.scrollHeight,behavior:"smooth"});
    return wrapper;
}
async function sendMessage(){
    if(!promptBox)return;
    const message=promptBox.value.trim();
    if(!message&&attachedFiles.length===0)return;
    if(menu)menu.classList.remove("open");
    if(welcome)welcome.style.display="none";
    const currentFiles=attachedFiles.map(function(file){
        return{name:file.name,content:file.content};
    });
    let finalMessage=message;
    if(!finalMessage&&currentFiles.length>0){
        finalMessage="Inspect the attached code. Find bugs or problems, explain them briefly, fix the code, and return the complete corrected code.";
    }
    addMessage("user",finalMessage);
    if(sendButton){
        sendButton.disabled=true;
        sendButton.textContent="…";
    }
    promptBox.value="";
    promptBox.style.height="42px";
    const loadingMessage=showLoading();
    try{
        const response=await fetch("/api/chat",{
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify({
                message:finalMessage,
                files:currentFiles,
                history:messages
            })
        });
        const data=await response.json();
        if(loadingMessage)loadingMessage.remove();
        if(!response.ok){
            throw new Error(data.error||"Something went wrong.");
        }
        messages.push({role:"user",content:finalMessage});
        messages.push({role:"assistant",content:data.answer});
        addMessage("assistant",data.answer);
        if(data.validation){
            let validationText;
            if(data.validation.ok){
                validationText="✓ "+data.validation.message;
            }else{
                validationText="⚠ "+data.validation.message;
            }
            addMessage("assistant",validationText);
        }
        attachedFiles=[];
        renderAttachedFiles();
        if(fileInput)fileInput.value="";
        saveRecentChat(finalMessage,messages);
        renderRecentChats();
    }catch(error){
        if(loadingMessage)loadingMessage.remove();
        console.error("CodeForge AI Error:",error);
        addMessage("assistant","⚠️ Error: "+error.message);
    }finally{
        if(sendButton){
            sendButton.disabled=false;
            sendButton.textContent="➤";
        }
        promptBox.focus();
    }
}
function createChatTitle(message){
    let title=message.replace(/\s+/g," ").trim();
    if(!title)title="New coding chat";
    if(title.length>50)title=title.substring(0,50)+"...";
    return title;
}
function saveRecentChat(title,chatMessages){
    const recentChats=getRecentChats();
    const newChat={
        id:Date.now().toString(),
        title:createChatTitle(title),
        messages:chatMessages,
        createdAt:new Date().toISOString()
    };
    recentChats.unshift(newChat);
    const limitedChats=recentChats.slice(0,15);
    localStorage.setItem(RECENT_STORAGE_KEY,JSON.stringify(limitedChats));
}
function getRecentChats(){
    try{
        const stored=localStorage.getItem(RECENT_STORAGE_KEY);
        if(!stored)return [];
        const parsed=JSON.parse(stored);
        if(!Array.isArray(parsed))return [];
        return parsed;
    }catch(error){
        console.error("Unable to load recent chats:",error);
        return [];
    }
}
function renderRecentChats(){
    const recentContainer=document.getElementById("recentChats");
    if(!recentContainer)return;
    recentContainer.innerHTML="";
    const recentChats=getRecentChats();
    if(recentChats.length===0){
        const empty=document.createElement("div");
        empty.className="recent-empty";
        empty.textContent="No recent chats";
        recentContainer.appendChild(empty);
        return;
    }
    recentChats.forEach(function(item){
        const recentItem=document.createElement("div");
        recentItem.className="recent-item";
        recentItem.title=item.title;
        recentItem.innerHTML=`<span class="recent-icon">◷</span><span class="recent-text"></span>`;
        const textElement=recentItem.querySelector(".recent-text");
        textElement.textContent=item.title;
        recentItem.addEventListener("click",function(){
            loadRecentChat(item.id);
        });
        recentContainer.appendChild(recentItem);
    });
}
function loadRecentChat(chatId){
    const recentChats=getRecentChats();
    const selectedChat=recentChats.find(function(item){
        return item.id===chatId;
    });
    if(!selectedChat)return;
    messages=[];
    if(chat)chat.innerHTML="";
    if(welcome)welcome.style.display="none";
    if(Array.isArray(selectedChat.messages)){
        selectedChat.messages.forEach(function(message){
            if(message.role==="user"||message.role==="assistant"){
                messages.push({
                    role:message.role,
                    content:message.content
                });
                addMessage(message.role,message.content);
            }
        });
    }
    attachedFiles=[];
    renderAttachedFiles();
    if(fileInput)fileInput.value="";
    if(promptBox){
        promptBox.value="";
        promptBox.style.height="42px";
        promptBox.focus();
    }
}
function newChat(){
    messages=[];
    attachedFiles=[];
    if(chat)chat.innerHTML="";
    if(attachedContainer)attachedContainer.innerHTML="";
    if(promptBox){
        promptBox.value="";
        promptBox.style.height="42px";
        promptBox.focus();
    }
    if(welcome)welcome.style.display="block";
    if(menu)menu.classList.remove("open");
    if(fileInput)fileInput.value="";
}
function clearRecentChats(){
    localStorage.removeItem(RECENT_STORAGE_KEY);
    renderRecentChats();
}
document.addEventListener("click",function(event){
    const plusButton=document.getElementById("plusButton");
    if(!menu||!plusButton)return;
    if(menu.classList.contains("open")&&!menu.contains(event.target)&&!plusButton.contains(event.target)){
        menu.classList.remove("open");
    }
});
document.addEventListener("keydown",function(event){
    if(event.key==="Escape"){
        if(menu)menu.classList.remove("open");
    }
});
document.addEventListener("DOMContentLoaded",function(){
    renderRecentChats();
    if(promptBox)promptBox.focus();
});