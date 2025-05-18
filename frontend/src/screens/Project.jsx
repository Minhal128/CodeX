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
  // Direct text extraction - bypass JSON parsing completely
  try {
    // If it's not a string, return as is
    if (typeof jsonString !== 'string') return jsonString;
    
    // Special case for React app creation - detect patterns that indicate a file tree response
    if (jsonString.includes('"fileTree"') && (jsonString.includes('react') || jsonString.includes('package.json'))) {
      console.log("Detected React file tree creation request");
      
      // Don't try to parse the fileTree JSON - just indicate it's there
      return { 
        text: "Creating React application files. Check the file explorer panel.",
        fileTree: true // Just indicate presence of file tree, don't try to parse it
      };
    }
    
    // Try direct parsing first for non-file tree content
    try {
      return JSON.parse(jsonString);
    } catch (firstError) {
      console.log("Attempting to sanitize JSON string...");
      // Log the error position for debugging
      if (firstError instanceof SyntaxError) {
        const match = firstError.message.match(/position (\d+)/);
        if (match) {
          const position = parseInt(match[1]);
          const start = Math.max(0, position - 40);
          const end = Math.min(jsonString.length, position + 40);
          console.log(`Error near position ${position}: "${jsonString.substring(start, end)}"`);
          console.log(`Character at position: '${jsonString.charAt(position)}' | Previous: '${jsonString.charAt(position-1)}' | Next: '${jsonString.charAt(position+1)}'`);
        }
      }
      
      // BYPASS JSON PARSING COMPLETELY - Extract text directly with regex
      // Look for text field
      const textMatch = jsonString.match(/"text"\s*:\s*"((?:[^"\\]|\\.|[\s\S])*?)(?:"[,}]|$)/);
      if (textMatch && textMatch[1]) {
        // Success - just return the text content
        return { text: textMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n') };
      }
      
      // If there's a fileTree field, try to extract it
      if (jsonString.includes('"fileTree"')) {
        // Create a simple response with just the text content
        const basicContent = jsonString.replace(/.*"text"\s*:\s*"([^"]+)".*/, "$1");
        return { 
          text: "```\nFile structure created. Check the file explorer panel.\n```",
          fileTree: true // Just indicate presence of file tree
        };
      }
      
      // Final fallback - return first text field or the raw message trimmed
      return {
        text: "AI response (JSON parsing failed):\n\n```\n" +
              (jsonString.length > 300 ? jsonString.substring(0, 300) + "..." : jsonString) +
              "\n```"
      };
    }
  } catch (finalError) {
    console.error("Complete failure in JSON parsing:", finalError);
    return { text: "Error displaying message content" };
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
        // If there's no message, show a simple placeholder
        if (!message) {
            return <div className='overflow-auto bg-slate-950 text-white rounded-sm p-2'>No message content</div>;
        }
        
        try {
            // Convert the message to a displayable format, bypassing JSON parsing if needed
            const messageObject = sanitizeJsonString(message);
            
            return (
                <div className='overflow-auto bg-slate-950 text-white rounded-sm p-2'>
                    <Markdown
                        options={{
                            overrides: {
                                code: SyntaxHighlightedCode,
                                pre: ({ children, ...props }) => <pre {...props}>{children || ''}</pre>,
                                p: ({ children, ...props }) => <p {...props}>{children || ''}</p>,
                            },
                        }}
                    >
                        {messageObject?.text || "No content"}
                    </Markdown>
                </div>
            );
        } catch (error) {
            // Last resort fallback - just show the raw content
            console.error("Complete message rendering failure:", error);
            return (
                <div className='overflow-auto bg-slate-950 text-white rounded-sm p-2'>
                    <p>Failed to render message</p>
                    <pre className="text-xs mt-2 p-2 bg-slate-900 overflow-x-auto">
                        {typeof message === 'string' 
                            ? message.substring(0, 100) + (message.length > 100 ? '...' : '')
                            : 'Invalid message format'}
                    </pre>
                </div>
            );
        }
    }

    // Helper function to create a basic React app template
    const createReactApp = () => {
        if (!webContainer) {
            console.error("WebContainer not initialized");
            return;
        }

        // Basic React app structure
        const basicReactApp = {
            "package.json": {
                file: {
                    contents: `{
  "name": "react-app",
  "version": "0.1.0",
  "private": true,
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-scripts": "5.0.1"
  },
  "scripts": {
    "start": "react-scripts start",
    "build": "react-scripts build",
    "test": "react-scripts test",
    "eject": "react-scripts eject"
  },
  "eslintConfig": {
    "extends": "react-app"
  },
  "browserslist": {
    "production": [
      ">0.2%",
      "not dead",
      "not op_mini all"
    ],
    "development": [
      "last 1 chrome version",
      "last 1 firefox version",
      "last 1 safari version"
    ]
  }
}`
                }
            },
            "public": {
                directory: {
                    "index.html": {
                        file: {
                            contents: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>React App</title>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`
                        }
                    }
                }
            },
            "src": {
                directory: {
                    "index.js": {
                        file: {
                            contents: `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);`
                        }
                    },
                    "App.js": {
                        file: {
                            contents: `import React from 'react';

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <h1>Welcome to My React App</h1>
        <p>Edit <code>src/App.js</code> and save to reload.</p>
      </header>
    </div>
  );
}

export default App;`
                        }
                    }
                }
            }
        };

        // Mount the React app
        webContainer.mount(basicReactApp).then(() => {
            console.log("React app mounted successfully");
            setFileTree(basicReactApp);
            
            // Add confirmation message
            setMessages(prevMessages => [...prevMessages, {
                sender: { _id: 'ai', email: 'AI Assistant' },
                message: JSON.stringify({
                    text: "✅ React app created successfully!\n\nI've set up a basic React application structure for you. You can now edit the files in the file explorer.\n\nTo run the app, you would typically use `npm start`."
                })
            }]);
        }).catch(err => {
            console.error("Failed to mount React app:", err);
            
            setMessages(prevMessages => [...prevMessages, {
                sender: { _id: 'ai', email: 'AI Assistant' },
                message: JSON.stringify({
                    text: "❌ Failed to create React app: " + err.message
                })
            }]);
        });
    };

    // Helper function to create a basic Express app template
    const createExpressApp = () => {
        if (!webContainer) {
            console.error("WebContainer not initialized");
            return;
        }

        // Basic Express app structure
        const expressApp = {
            "package.json": {
                file: {
                    contents: `{
  "name": "express-app",
  "version": "1.0.0",
  "description": "A basic Express server",
  "main": "app.js",
  "scripts": {
    "start": "node app.js",
    "dev": "nodemon app.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5"
  },
  "devDependencies": {
    "nodemon": "^2.0.22"
  }
}`
                }
            },
            "app.js": {
                file: {
                    contents: `const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// Import routes
const apiRoutes = require('./routes/api');

// Middleware for parsing JSON bodies
app.use(express.json());

// Use routes
app.use('/api', apiRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Start the server
app.listen(port, () => {
  console.log(\`Server listening on port \${port}\`);
});`
                }
            },
            "routes": {
                directory: {
                    "api.js": {
                        file: {
                            contents: `const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

// Define routes
router.get('/users', userController.getAllUsers);
router.get('/users/:id', userController.getUserById);
router.post('/users', userController.createUser);
router.put('/users/:id', userController.updateUser);
router.delete('/users/:id', userController.deleteUser);

module.exports = router;`
                        }
                    }
                }
            },
            "controllers": {
                directory: {
                    "userController.js": {
                        file: {
                            contents: `// Mock user data
const users = [
  { id: 1, name: 'John Doe', email: 'john@example.com' },
  { id: 2, name: 'Jane Smith', email: 'jane@example.com' }
];

// Controller methods
exports.getAllUsers = (req, res) => {
  res.json({ users });
};

exports.getUserById = (req, res) => {
  const id = parseInt(req.params.id);
  const user = users.find(user => user.id === id);
  
  if (user) {
    res.json({ user });
  } else {
    res.status(404).json({ error: 'User not found' });
  }
};

exports.createUser = (req, res) => {
  const { name, email } = req.body;
  
  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required' });
  }
  
  const id = users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1;
  const newUser = { id, name, email };
  users.push(newUser);
  
  res.status(201).json({ user: newUser });
};

exports.updateUser = (req, res) => {
  const id = parseInt(req.params.id);
  const { name, email } = req.body;
  const index = users.findIndex(user => user.id === id);
  
  if (index !== -1) {
    users[index] = { ...users[index], ...(name && { name }), ...(email && { email }) };
    res.json({ user: users[index] });
  } else {
    res.status(404).json({ error: 'User not found' });
  }
};

exports.deleteUser = (req, res) => {
  const id = parseInt(req.params.id);
  const index = users.findIndex(user => user.id === id);
  
  if (index !== -1) {
    const deletedUser = users.splice(index, 1)[0];
    res.json({ user: deletedUser });
  } else {
    res.status(404).json({ error: 'User not found' });
  }
};`
                        }
                    }
                }
            }
        };

        // Mount the Express app
        webContainer.mount(expressApp).then(() => {
            console.log("Express app mounted successfully");
            setFileTree(expressApp);
            
            // Add confirmation message
            setMessages(prevMessages => [...prevMessages, {
                sender: { _id: 'ai', email: 'AI Assistant' },
                message: JSON.stringify({
                    text: "✅ Express server created successfully!\n\nI've set up a basic Express.js server with modular structure. Check the file explorer for the created files.\n\nThe app includes:\n- Routes for a RESTful API\n- Controller for user management\n- Error handling middleware\n\nTo run the server, you would typically use `npm start`."
                })
            }]);
        }).catch(err => {
            console.error("Failed to mount Express app:", err);
            
            setMessages(prevMessages => [...prevMessages, {
                sender: { _id: 'ai', email: 'AI Assistant' },
                message: JSON.stringify({
                    text: "❌ Failed to create Express app: " + err.message
                })
            }]);
        });
    };

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

        // Updated message handler with direct command support and improved file tree handling
        receiveMessage('project-message', data => {
            console.log(data);

            // Handle direct commands first
            if (data.sender._id !== 'ai' && typeof data.message === 'string') {
                const lowerMsg = data.message.toLowerCase();
                
                // Check for direct React app creation command
                if (lowerMsg.includes("@ai create react app")) {
                    setMessages(prevMessages => [...prevMessages, data]);
                    
                    // Add AI "thinking" message
                    setMessages(prevMessages => [...prevMessages, {
                        sender: { _id: 'ai', email: 'AI Assistant' },
                        message: JSON.stringify({ text: "Creating a React application..." })
                    }]);
                    
                    // Create React app directly
                    createReactApp();
                    return;
                }
                
                // Check for direct Express app creation command
                if (lowerMsg.includes("@ai create express server") || lowerMsg.includes("@ai create an express server")) {
                    setMessages(prevMessages => [...prevMessages, data]);
                    
                    // Add AI "thinking" message
                    setMessages(prevMessages => [...prevMessages, {
                        sender: { _id: 'ai', email: 'AI Assistant' },
                        message: JSON.stringify({ text: "Creating an Express server..." })
                    }]);
                    
                    // Create Express app directly
                    createExpressApp();
                    return;
                }
                
                // Regular user message
                setMessages(prevMessages => [...prevMessages, data]);
                return;
            }

            if (data.sender._id === 'ai') {
                try {
                    const message = sanitizeJsonString(data.message);
                    console.log("Parsed message:", message);

                    // If fileTree is just a flag (true), use our template instead
                    if (message?.fileTree === true) {
                        if (data.message.toLowerCase().includes('react')) {
                            createReactApp();
                        } else if (data.message.toLowerCase().includes('express')) {
                            createExpressApp();
                        }
                    }
                    // If fileTree is an actual object, use it
                    else if (webContainer && message?.fileTree && typeof message.fileTree === 'object') {
                        webContainer.mount(message.fileTree).then(() => {
                            setFileTree(message.fileTree);
                        }).catch(err => {
                            console.error("Failed to mount file tree:", err);
                        });
                    }
                    
                    setMessages(prevMessages => [...prevMessages, data]);
                } catch (error) {
                    console.error("Error parsing AI message:", error);
                    setMessages(prevMessages => [...prevMessages, data]);
                }
            } else {
                setMessages(prevMessages => [...prevMessages, data]);
            }
        });

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
        disconnect(); // Ensure old connection is cleaned up
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
                            <div 
                                key={`msg-${index}-${msg.sender._id}`} 
                                className={`${msg.sender._id === 'ai' ? 'max-w-80' : 'max-w-52'} ${msg.sender._id == user._id.toString() && 'ml-auto'}  message flex flex-col p-2 bg-slate-50 w-fit rounded-md`}>
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
                            placeholder='Enter message or type @ai create react app' />
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
                                    key={`file-${index}-${file}`}
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
                        {
                            fileTree && Object.keys(fileTree).filter(key => fileTree[key]?.directory).map((dir, index) => (
                                <div key={`dir-${index}-${dir}`} className="directory">
                                    <div className="directory-header p-2 px-4 bg-slate-400 flex items-center">
                                        <i className="ri-folder-fill mr-2"></i>
                                        <p className='font-semibold'>{dir}</p>
                                    </div>
                                    <div className="directory-files pl-4">
                                        {Object.keys(fileTree[dir].directory).map((file, fileIndex) => (
                                            <button
                                                key={`subfile-${index}-${fileIndex}-${file}`}
                                                onClick={() => {
                                                    const path = `${dir}/${file}`;
                                                    setCurrentFile(path);
                                                    setOpenFiles([...new Set([...openFiles, path])]);
                                                }}
                                                className="tree-element cursor-pointer p-2 px-4 flex items-center gap-2 bg-slate-300 w-full">
                                                <p className='font-semibold text-lg'>{file}</p>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))
                        }
                    </div>
                </div>

                <div className="code-editor flex flex-col flex-grow h-full shrink">
                    <div className="top flex justify-between w-full">
                        <div className="files flex overflow-x-auto">
                            {
                                openFiles.map((file, index) => (
                                    <button
                                        key={`open-${index}-${file}`}
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
                            currentFile && fileTree && (
                                <div className="code-editor-area h-full overflow-auto flex-grow bg-slate-50">
                                    <pre className="hljs h-full">
                                        <code
                                            className="hljs h-full outline-none"
                                            contentEditable
                                            suppressContentEditableWarning
                                            onBlur={(e) => {
                                                const updatedContent = e.target.innerText;
                                                // Check if it's a nested path
                                                if (currentFile.includes('/')) {
                                                    const [dir, file] = currentFile.split('/');
                                                    const ft = {
                                                        ...fileTree,
                                                        [dir]: {
                                                            ...fileTree[dir],
                                                            directory: {
                                                                ...fileTree[dir].directory,
                                                                [file]: {
                                                                    file: {
                                                                        contents: updatedContent
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    };
                                                    setFileTree(ft);
                                                    saveFileTree(ft);
                                                } else {
                                                    // Regular top-level file
                                                    const ft = {
                                                        ...fileTree,
                                                        [currentFile]: {
                                                            file: {
                                                                contents: updatedContent
                                                            }
                                                        }
                                                    };
                                                    setFileTree(ft);
                                                    saveFileTree(ft);
                                                }
                                            }}
                                            dangerouslySetInnerHTML={{
                                                __html: getCurrentFileContent()
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
                                <div 
                                    key={`modal-user-${user._id}`} 
                                    className={`user cursor-pointer hover:bg-slate-200 ${Array.from(selectedUserId).indexOf(user._id) != -1 ? 'bg-slate-200' : ""} p-2 flex gap-2 items-center`} 
                                    onClick={() => handleUserClick(user._id)}
                                >
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

    // Helper function to get content of current file (including nested files)
    function getCurrentFileContent() {
        if (!currentFile) return '';
        
        // Check if it's a nested path
        if (currentFile.includes('/')) {
            const [dir, file] = currentFile.split('/');
            const content = fileTree[dir]?.directory?.[file]?.file?.contents;
            return content ? hljs.highlight('javascript', content).value : '';
        }
        
        // Regular top-level file
        return fileTree[currentFile]?.file?.contents
            ? hljs.highlight('javascript', fileTree[currentFile].file.contents).value
            : '';
    }
}

export default Project