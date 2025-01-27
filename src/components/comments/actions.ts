"use server"

import getServerSession from "@/lib/get-server-session";
import { prisma } from "@/lib/prisma";
import { getCommentDataInclude, PostData } from "@/lib/types";
import { createCommentSchema } from "@/lib/validations";



export async function submitComment({content, post} :{content: string, post:PostData}) {
    const session=await getServerSession()
    const user=session?.user
    if(!user) throw Error("Unauthorized")

    const {content:validatedContent}= createCommentSchema.parse({content})  

    const [newComment]=await prisma.$transaction([
        prisma.comment.create({
            data:{
                content: validatedContent,
                postId: post.id, 
                userId:user.id!,
            },
            include:getCommentDataInclude(user.id!)
        }),
        ...(post.userId!==user.id? [
            prisma.notification.create({
                data:{
                    issuerId: user.id!,
                    recipientId: post.userId,
                    postId: post.id,
                    type: "COMMENT"
                }
            })
        ]:[])
    ])

    return newComment

}

export async function deleteComment( id:string) {
    const session=await getServerSession()
    const user=session?.user
    if(!user) throw Error("Unauthorized")
 

    const comment=await prisma.comment.findUnique({
        where:{id}
    })
    if(!comment) throw new Error("comment not found")
    if(comment.userId !==user.id) throw new Error("Unauthorized")
    
    const deletedComment=await prisma.comment.delete({
        where:{id},
        include:getCommentDataInclude(user.id)
    })

    return deletedComment

}