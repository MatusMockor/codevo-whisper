set(CW_STT_WORKER_DIR "${CMAKE_CURRENT_LIST_DIR}")

function(cw_add_stt_worker)
    add_executable(cw-stt-worker "${CW_STT_WORKER_DIR}/stt-worker.c" "${CW_STT_WORKER_DIR}/stt-worker-request.c")
    target_link_libraries(cw-stt-worker PRIVATE transcribe)
    set_target_properties(cw-stt-worker PROPERTIES C_STANDARD 11)
    if(CMAKE_C_COMPILER_ID MATCHES "Clang|GNU")
        target_compile_options(cw-stt-worker PRIVATE -Wall -Wextra -Werror)
    endif()
endfunction()

cmake_language(DEFER DIRECTORY "${CMAKE_SOURCE_DIR}" CALL cw_add_stt_worker)
