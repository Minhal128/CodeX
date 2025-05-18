import React, { useState, useEffect, useContext, useRef } from 'react'
import { UserContext } from '../context/user.context'
import { useNavigate, useLocation } from 'react-router-dom'
import axios from '../config/axios'
import { initializeSocket, receiveMessage, sendMessage, disconnect } from '../config/socket'
import Markdown from 'markdown-to-jsx'
import hljs from 'highlight.js';
import { getWebContainer } from '../config/webcontainer'
import PropTypes from 'prop-types'

function sanitizeJsonString(jsonString) {
  if (typeof jsonString !== 'string') return jsonString;
  
  try {
    // First try regular parsing
    return JSON.parse(jsonString);
  } catch (error) {
    console.log("Attempting to sanitize JSON string...");
    
    try {
      // More aggressive sanitization:
      let sanitized = jsonString
        // 1. Replace unescaped backslashes
        .replace(/([^\\])(\\)([^\\/"bfnrtu])/g, '$1\\\\$3')
        // 2. Fix newlines
        .replace(/([^\\])\\n/g, '$1\\\\n')
        // 3. Fix tabs
        .replace(/([^\\])\\t/g, '$1\\\\t')
        // 4. Add quotes around unquoted property names
        .replace(/([{,]\s*)([a-zA-Z0-9_$]+)(\s*:)/g, '$1"$2"$3')
        // 5. Fix trailing commas in objects/arrays
        .replace(/,(\s*[}\]])/g, '$1');
      
      // Try to balance braces and brackets
      let braceCount = 0, bracketCount = 0;
      for (let i = 0; i < sanitized.length; i++) {
        if (sanitized[i] === '{') braceCount++;
        if (sanitized[i] === '}') braceCount--;
        if (sanitized[i] === '[') bracketCount++;
        if (sanitized[i] === ']') bracketCount--;
      }
      
      // Add missing closing braces/brackets
      while (braceCount > 0) {
        sanitized += '}';
        braceCount--;
      }
      while (bracketCount > 0) {
        sanitized += ']';
        bracketCount--;
      }
      
      return JSON.parse(sanitized);
    } catch (secondError) {
      console.error("Failed to sanitize JSON:", secondError);
      
      // Last resort: return a simple object with text
      try {
        // Try to extract just text content
        const textMatch = jsonString.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        if (textMatch && textMatch[1]) {
          return { text: textMatch[1].replace(/\\"/g, '"') };
        }
        
        // If that fails, return a basic fallback response
        return { 
          text: "Error: Could not parse AI response. Please try again with a simpler request." 
        };
      } catch (e) {
        console.error("Couldn't extract text from malformed JSON");
        return { text: "Error processing AI response" };
      }
    }
  }
}

function SyntaxHighlightedCode(props) {
    const ref = useRef(null)

    React.useEffect(() => {
        if (ref.current && props.className?.includes('lang-') && window.hljs) {
            window.hljs.highlightElement(ref.current)

            // hljs won't reprocess the element unless this attribute is removed
            ref.current.removeAttribute('data-highlighted')
        }
    }, [props.className, props.children])

    return <code {...props} ref={ref} />
}

SyntaxHighlightedCode.propTypes = {
    className: PropTypes.string,
    children: PropTypes.node
}

const Project = () => {
    const location = useLocation()
    const messageBox = useRef(null)
    const socketRef = useRef(null)

    const [isSidePanelOpen, setIsSidePanelOpen] = useState(false)
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [selectedUserId, setSelectedUserId] = useState(new Set())
    const [project, setProject] = useState(location.state?.project || {})
    const [message, setMessage] = useState('')
    const { user } = useContext(UserContext)

    const [users, setUsers] = useState([])
    const [messages, setMessages] = useState([])
    const [fileTree, setFileTree] = useState({})
    const [socketError, setSocketError] = useState(null)

    const [currentFile, setCurrentFile] = useState(null)
    const [openFiles, setOpenFiles] = useState([])

    const [webContainer, setWebContainer] = useState(null)
    const [iframeUrl, setIframeUrl] = useState(null)

    const [runProcess, setRunProcess] = useState(null)

    const handleUserClick = (id) => {
        setSelectedUserId(prevSelectedUserId => {
            const newSelectedUserId = new Set(prevSelectedUserId);
            if (newSelectedUserId.has(id)) {
                newSelectedUserId.delete(id);
            } else {
                newSelectedUserId.add(id);
            }
            return newSelectedUserId;
        });
    }

    function addCollaborators() {
        if (!project?._id) {
            console.error("Project ID missing");
            return;
        }
        
        axios.put("/projects/add-user", {
            projectId: project._id,
            users: Array.from(selectedUserId)
        }).then(res => {
            console.log(res.data)
            setIsModalOpen(false)
        }).catch(err => {
            console.log(err)
        })
    }

    const send = () => {
        if (!message.trim()) return;
        
        const success = sendMessage('project-message', {
            message,
            sender: user
        });
        
        if (success) {
            setMessages(prevMessages => [...prevMessages, { sender: user, message }])
            setMessage("")
        } else {
            setSocketError("Failed to send message. Connection might be lost.")
            
            // Try to reconnect socket
            socketRef.current = initializeSocket(project._id)
        }
    }

   function WriteAiMessage(message) {
    try {
        const messageObject = sanitizeJsonString(message);
        return (
            <div className='overflow-auto bg-slate-950 text-white rounded-sm p-2'>
                <Markdown
                    options={{
                        overrides: {
                            code: SyntaxHighlightedCode,
                        },
                    }}
                >
                    {messageObject?.text || "No content"}
                </Markdown>
            </div>
        );
    } catch (error) {
        console.error("JSON parse error:", error);
        // Fallback to raw message display with length limit
        return (
            <div className='overflow-auto bg-slate-950 text-white rounded-sm p-2'>
                <p>Failed to parse message: {
                    typeof message === 'string' 
                    ? (message.length > 100 ? message.substring(0, 100) + '...' : message) 
                    : 'Invalid message format'
                }</p>
            </div>
        );
    }
}

    useEffect(() => {
        if (!project?._id) {
            console.error("Project ID missing");
            return;
        }

        // Initialize socket with better error handling
        socketRef.current = initializeSocket(project._id);
        
        if (!socketRef.current) {
            setSocketError("Failed to initialize socket connection. Project ID may be invalid.");
            return;
        }

        if (!webContainer) {
            getWebContainer().then(container => {
                setWebContainer(container)
                console.log("container started")
            }).catch(err => {
                console.error("Failed to start webcontainer:", err)
            })
        }

        // Updated message handler to use sanitizeJsonString
        receiveMessage('project-message', data => {
            console.log(data)

            if (data.sender._id === 'ai') {
                try {
                    const message = sanitizeJsonString(data.message)
                    console.log("Parsed message:", message)

                    if (webContainer && message?.fileTree) {
                        webContainer.mount(message.fileTree).catch(err => {
                            console.error("Failed to mount file tree:", err)
                        })
                    }

                    if (message?.fileTree) {
                        setFileTree(message.fileTree || {})
                    }
                    setMessages(prevMessages => [...prevMessages, data])
                } catch (error) {
                    console.error("Error parsing AI message:", error);
                    setMessages(prevMessages => [...prevMessages, data])
                }
            } else {
                setMessages(prevMessages => [...prevMessages, data])
            }
        })

        axios.get(`/projects/get-project/${project._id}`).then(res => {
            console.log(res.data.project)
            setProject(res.data.project)
            setFileTree(res.data.project.fileTree || {})
        }).catch(err => {
            console.error("Failed to fetch project:", err)
        })

        axios.get('/users/all').then(res => {
            setUsers(res.data.users)
        }).catch(err => {
            console.log(err)
        })

        // Cleanup function
        return () => {
            disconnect();
        };
    }, [project._id])

    // Scroll to bottom when messages change
    useEffect(() => {
        scrollToBottom()
    }, [messages])

    function saveFileTree(ft) {
        if (!project?._id) {
            console.error("Project ID missing");
            return;
        }
        
        axios.put('/projects/update-file-tree', {
            projectId: project._id,
            fileTree: ft
        }).then(res => {
            console.log(res.data)
        }).catch(err => {
            console.log(err)
        })
    }

    function scrollToBottom() {
        if (messageBox.current) {
            messageBox.current.scrollTop = messageBox.current.scrollHeight
        }
    }

    // Retry socket connection function
    const retryConnection = () => {
        setSocketError(null);
        socketRef.current = initializeSocket(project._id);
        if (socketRef.current) {
            alert("Attempting to reconnect...");
        }
    }

    return (
        <main className='h-screen w-screen flex'>
            <section className="left relative flex flex-col h-screen min-w-96 bg-slate-300">
                <header className='flex justify-between items-center p-2 px-4 w-full bg-slate-100 absolute z-10 top-0'>
                    <button className='flex gap-2' onClick={() => setIsModalOpen(true)}>
                        <i className="ri-add-fill mr-1"></i>
                        <p>Add collaborator</p>
                    </button>
                    <button onClick={() => setIsSidePanelOpen(!isSidePanelOpen)} className='p-2'>
                        <i className="ri-group-fill"></i>
                    </button>
                </header>
                <div className="conversation-area pt-14 pb-10 flex-grow flex flex-col h-full relative">
                    {socketError && (
                        <div className="socket-error bg-red-100 border-l-4 border-red-500 text-red-700 p-3 mb-2 flex justify-between">
                            <p>{socketError}</p>
                            <button onClick={retryConnection} className="underline">Retry</button>
                        </div>
                    )}
                    
                    <div
                        ref={messageBox}
                        className="message-box p-1 flex-grow flex flex-col gap-1 overflow-auto max-h-full scrollbar-hide">
                        {messages.map((msg, index) => (
                            <div key={index} className={`${msg.sender._id === 'ai' ? 'max-w-80' : 'max-w-52'} ${msg.sender._id == user._id.toString() && 'ml-auto'}  message flex flex-col p-2 bg-slate-50 w-fit rounded-md`}>
                                <small className='opacity-65 text-xs'>{msg.sender.email}</small>
                                <div className='text-sm'>
                                    {msg.sender._id === 'ai' ?
                                        WriteAiMessage(msg.message)
                                        : <p>{msg.message}</p>}
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="inputField w-full flex absolute bottom-0">
                        <input
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && send()}
                            className='p-2 px-4 border-none outline-none flex-grow' 
                            type="text" 
                            placeholder='Enter message' />
                        <button
                            onClick={send}
                            className='px-5 bg-slate-950 text-white'><i className="ri-send-plane-fill"></i></button>
                    </div>
                </div>
                <div className={`sidePanel w-full h-full flex flex-col gap-2 bg-slate-50 absolute transition-all ${isSidePanelOpen ? 'translate-x-0' : '-translate-x-full'} top-0`}>
                    <header className='flex justify-between items-center px-4 p-2 bg-slate-200'>
                        <h1
                            className='font-semibold text-lg'
                        >Collaborators</h1>

                        <button onClick={() => setIsSidePanelOpen(!isSidePanelOpen)} className='p-2'>
                            <i className="ri-close-fill"></i>
                        </button>
                    </header>
                    <div className="users flex flex-col gap-2">
                        {project.users && project.users.map(user => {
                            return (
                                <div key={user._id} className="user cursor-pointer hover:bg-slate-200 p-2 flex gap-2 items-center">
                                    <div className='aspect-square rounded-full w-fit h-fit flex items-center justify-center p-5 text-white bg-slate-600'>
                                        <i className="ri-user-fill absolute"></i>
                                    </div>
                                    <h1 className='font-semibold text-lg'>{user.email}</h1>
                                </div>
                            )
                        })}
                    </div>
                </div>
            </section>

            <section className="right bg-red-50 flex-grow h-full flex">
                <div className="explorer h-full max-w-64 min-w-52 bg-slate-200">
                    <div className="file-tree w-full">
                        {
                            fileTree && Object.keys(fileTree).map((file, index) => (
                                <button
                                    key={index}
                                    onClick={() => {
                                        setCurrentFile(file)
                                        setOpenFiles([...new Set([...openFiles, file])])
                                    }}
                                    className="tree-element cursor-pointer p-2 px-4 flex items-center gap-2 bg-slate-300 w-full">
                                    <p
                                        className='font-semibold text-lg'
                                    >{file}</p>
                                </button>))
                        }
                    </div>
                </div>

                <div className="code-editor flex flex-col flex-grow h-full shrink">
                    <div className="top flex justify-between w-full">
                        <div className="files flex overflow-x-auto">
                            {
                                openFiles.map((file, index) => (
                                    <button
                                        key={index}
                                        onClick={() => setCurrentFile(file)}
                                        className={`open-file cursor-pointer p-2 px-4 flex items-center w-fit gap-2 bg-slate-300 ${currentFile === file ? 'bg-slate-400' : ''}`}>
                                        <p
                                            className='font-semibold text-lg'
                                        >{file}</p>
                                    </button>
                                ))
                            }
                        </div>
                    </div>
                    <div className="bottom flex flex-grow max-w-full shrink overflow-auto">
                        {
                            currentFile && fileTree && fileTree[currentFile] && fileTree[currentFile]?.file && (
                                <div className="code-editor-area h-full overflow-auto flex-grow bg-slate-50">
                                    <pre className="hljs h-full">
                                        <code
                                            className="hljs h-full outline-none"
                                            contentEditable
                                            suppressContentEditableWarning
                                            onBlur={(e) => {
                                                const updatedContent = e.target.innerText;
                                                const ft = {
                                                    ...fileTree,
                                                    [currentFile]: {
                                                        file: {
                                                            contents: updatedContent
                                                        }
                                                    }
                                                }
                                                setFileTree(ft)
                                                saveFileTree(ft)
                                            }}
                                            dangerouslySetInnerHTML={{
                                                __html: fileTree[currentFile]?.file?.contents
                                                    ? hljs.highlight('javascript', fileTree[currentFile].file.contents).value
                                                    : ''
                                            }}
                                            style={{
                                                whiteSpace: 'pre-wrap',
                                                paddingBottom: '25rem',
                                                counterSet: 'line-numbering',
                                            }}
                                        />
                                    </pre>
                                </div>
                            )
                        }
                    </div>
                </div>

                {iframeUrl && webContainer &&
                    (<div className="flex min-w-96 flex-col h-full">
                        <div className="address-bar">
                            <input type="text"
                                onChange={(e) => setIframeUrl(e.target.value)}
                                value={iframeUrl} className="w-full p-2 px-4 bg-slate-200" />
                        </div>
                        <iframe src={iframeUrl} className="w-full h-full"></iframe>
                    </div>)
                }
            </section>

            {isModalOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
                    <div className="bg-white p-4 rounded-md w-96 max-w-full relative">
                        <header className='flex justify-between items-center mb-4'>
                            <h2 className='text-xl font-semibold'>Select User</h2>
                            <button onClick={() => setIsModalOpen(false)} className='p-2'>
                                <i className="ri-close-fill"></i>
                            </button>
                        </header>
                        <div className="users-list flex flex-col gap-2 mb-16 max-h-96 overflow-auto">
                            {users.map(user => (
                                <div key={user._id} className={`user cursor-pointer hover:bg-slate-200 ${Array.from(selectedUserId).indexOf(user._id) != -1 ? 'bg-slate-200' : ""} p-2 flex gap-2 items-center`} onClick={() => handleUserClick(user._id)}>
                                    <div className='aspect-square relative rounded-full w-fit h-fit flex items-center justify-center p-5 text-white bg-slate-600'>
                                        <i className="ri-user-fill absolute"></i>
                                    </div>
                                    <h1 className='font-semibold text-lg'>{user.email}</h1>
                                </div>
                            ))}
                        </div>
                        <button
                            onClick={addCollaborators}
                            className='absolute bottom-4 left-1/2 transform -translate-x-1/2 px-4 py-2 bg-blue-600 text-white rounded-md'>
                            Add Collaborators
                        </button>
                    </div>
                </div>
            )}
        </main>
    )
}

export default Project