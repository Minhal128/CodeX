; .model small
; .stack 100h
; .data
;     msg1   db "Enter the roll number:",13,10,'$'
;     msg2   db "Your roll number is:",13,10,'$'
;     buffer db 10 
;         db ?
;         db 10 dup(0)
; .code
; main proc
;          mov ax,@data
;          mov ds,ax

;          mov ax,09h
;          lea dx,msg1
;          int 21h

;          lea dx,buffer
;          mov ah,0Ah
;          int 21h

;          mov ax,09h
;          lea dx,msg2
;          int 21h

;          mov dl,buffer+2
;          mov ah,02h
;          int 21h
;          mov dl,buffer+3
;          mov ah,02h
;          int 21h
;          mov dl,buffer+4
;          mov ah,02h
;          int 21h
;          mov dl,buffer+5
;          mov ah,02h
;          int 21h
;          mov dl,buffer+6
;          mov ah,02h
;          int 21h
;          mov dl,buffer+7
;          mov ah,02h
;          int 21h
;          mov dl,buffer+8
;          mov ah,02h
;          int 21h
;          mov dl,buffer+9
;          mov ah,02h
;          int 21h

;          mov ah,4ch
;          int 21h
; main endp
; end main




; .model small
; .stack 100h   
; .data
;     msg db "Hi Minhal :)" ,13,10,'$'
; .code
; main proc
;     mov ax,@data
;     mov ds,ax

;     mov cx,10
;     start:
;     mov ah,09h
;     lea dx,msg
;     int 21h
;     loop start
; main endp
; end main

; .model small
; .stack 100h
; .data
; 	msg1 db "Enter the first number",13,10,'$'
; 	msg2 db "Enter the second number",13,10,'$'
; 	msg3 db "Sum:",13,10,'$'
; 	result db ?
; .code
; main proc
; 	mov ax,@data
; 	mov ds,ax
; 	mov ah,09h
; 	lea dx,msg1
; 	int 21h
; 	mov ah,01h
; 	int 21h
; 	sub al,'0'
; 	mov bl,al

; 	mov ah,09h
; 	lea dx,msg2
; 	int 21h
; 	mov ah,01h
; 	int 21h
;     sub al,'0'
; 	add bl,al
; 	add bl,'0'

; 	mov ah,09h
; 	lea dx,msg3
; 	int 21h

;     mov ah,02h
;     mov dl,bl
;     int 21h
; 	mov ah,4ch
; 	int 21h
; main endp
; end main

